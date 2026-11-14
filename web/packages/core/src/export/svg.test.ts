import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeLabelLayout } from '../layout/labels';
import type { ProjectSnapshot } from '../model/project';
import { loadProject } from '../project/project';
import { toScreen } from '../projection/projection';
import { notoSans, notoSansArabic } from '../testing/fonts';
import { TextMeasurer } from '../text/metrics';
import { FontRegistry } from '../text/registry';
import { exportPixelSize, exportProjection, exportSVG, fitHeightToArea, type SvgExportOptions } from './svg';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '../layout/fixtures');
const font = notoSans();
const registry = new FontRegistry({ regular: [font, notoSansArabic()], bold: [font, notoSansArabic()] });
registry.add('Noto Sans', 'Regular', font);
const measurer = new TextMeasurer(registry);

function project(): ProjectSnapshot {
  const loaded = loadProject(readFileSync(path.join(fixtures, 'macos-noto-project.json'), 'utf8'));
  // The fixture has no export area; frame its features.
  return {
    ...loaded,
    boundingBox: { minLat: 54.6625, minLon: -2.7525, maxLat: 54.6685, maxLon: -2.7475 },
    artboardBackgroundEnabled: true,
    artboardBackground: { r: 0.9, g: 0.95, b: 1, a: 1 },
  };
}

const options = (over: Partial<SvgExportOptions> = {}): SvgExportOptions => ({
  widthMM: 100,
  heightMM: 100,
  dpi: 96,
  text: 'outlines',
  ...over,
});

function run(p: ProjectSnapshot, o: SvgExportOptions) {
  const layout = computeLabelLayout(p.layers, p.baseZoom, 1, measurer);
  return { layout, svg: exportSVG(p, layout, measurer, o) };
}

describe('exportPixelSize and exportProjection', () => {
  it('converts millimetres at a resolution to pixels', () => {
    expect(exportPixelSize({ widthMM: 25.4, heightMM: 50.8, dpi: 300 })).toEqual({ width: 300, height: 600 });
  });

  it('fits the area to the artboard width and scales artwork by the zoom difference', () => {
    const p = project();
    const { projection, scale } = exportProjection(p, options());
    expect(projection.viewport.width).toBeCloseTo(377.95, 1);
    expect(projection.centerLat).toBeCloseTo(54.6655, 6);
    expect(scale).toBeCloseTo(2 ** (projection.zoom - p.baseZoom), 10);
  });

  it('needs an area', () => {
    expect(() => exportProjection({ ...project(), boundingBox: undefined }, options())).toThrow(/no area/);
  });
});

describe('fitHeightToArea', () => {
  it('frames the area exactly: the exported projection then shows the area edge to edge', () => {
    const p = project();
    const widthMM = 150;
    const heightMM = fitHeightToArea(p.boundingBox!, widthMM);
    const { projection } = exportProjection(p, { widthMM, heightMM, dpi: 96 });
    // The area's north-west and south-east corners land on the artboard's corners.
    const nw = toScreen(projection, p.boundingBox!.maxLat, p.boundingBox!.minLon);
    const se = toScreen(projection, p.boundingBox!.minLat, p.boundingBox!.maxLon);
    expect(nw.x).toBeCloseTo(0, 3);
    expect(se.x).toBeCloseTo(projection.viewport.width, 3);
    // Vertically it is centred on the middle latitude, as in the macOS exporter, and Mercator is
    // not linear in latitude, so the edges can be off by a fraction of a pixel on a small area.
    expect(Math.abs(nw.y)).toBeLessThan(0.1);
    expect(Math.abs(se.y - projection.viewport.height)).toBeLessThan(0.1);
  });

  it('is taller for a taller area and falls back to a square for a degenerate one', () => {
    const wide = fitHeightToArea({ minLat: 0, maxLat: 1, minLon: 0, maxLon: 2 }, 100);
    const tall = fitHeightToArea({ minLat: 0, maxLat: 2, minLon: 0, maxLon: 1 }, 100);
    expect(tall).toBeGreaterThan(wide);
    expect(fitHeightToArea({ minLat: 0, maxLat: 1, minLon: 5, maxLon: 5 }, 100)).toBe(100);
  });
});

describe('exportSVG', () => {
  it('writes a sized document with the macOS group structure, background first', () => {
    const { svg } = run(project(), options());
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(svg).toContain('width="377.95" height="377.95"');
    expect(svg).toContain('viewBox="0 0 377.95 377.95"');
    expect(svg).toContain('<g id="icons">');
    expect(svg).toContain('<g id="labels">');
    expect(svg).toMatch(/<rect x="0" y="0" width="377.95" height="377.95" fill="#E5F2FF"\/>/);
    expect(svg.indexOf('<rect x="0"')).toBeLessThan(svg.indexOf('<g id="layer-'));
    expect(svg).toMatch(/<g id="layer-roads-[0-9A-Za-z-]+">/);
    expect(svg).toMatch(/<g id="labels-Roads-/);
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('draws geometry for every visible layer and hides hidden ones', () => {
    const p = project();
    const all = run(p, options()).svg;
    expect(all).toContain('layer-parks-');
    expect(all).toContain('layer-landmarks-');
    const hiddenPark = run({ ...p, layers: p.layers.map((l) => (l.kind === 'parks' ? { ...l, isVisible: false } : l)) }, options()).svg;
    expect(hiddenPark).not.toContain('layer-parks-');
    expect(hiddenPark).not.toContain('labels-Parks');
  });

  it('writes outlined labels as paths, one per label, with no live text', () => {
    const { svg, layout } = run(project(), options({ text: 'outlines' }));
    expect(svg).not.toContain('<text');
    const labelPaths = svg.match(/<path d="M[^"]*" fill="#[0-9A-F]{6}"[^>]*><title>/g) ?? [];
    expect(labelPaths).toHaveLength(layout.lineLabels.length + layout.pointLabels.length);
    for (const name of ['High Street', 'King Street', 'Clock Tower', 'Castle Park']) {
      expect(svg).toContain(`<title>${name}</title>`);
    }
  });

  it('writes live labels as text, curved ones on a guide path', () => {
    const { svg, layout } = run(project(), options({ text: 'live' }));
    expect(svg).not.toContain('<title>');
    const curved = layout.lineLabels.filter((l) => l.style.lineLabelMode === 'curved').length;
    expect(curved).toBeGreaterThan(0);
    expect((svg.match(/<textPath /g) ?? []).length).toBe(curved);
    expect((svg.match(/<path id="lblguide\d+"/g) ?? []).length).toBe(curved);
    expect(svg).toContain('font-family="Noto Sans, Helvetica, sans-serif"');
    expect(svg).toContain('>Clock Tower</text>');
  });

  it('turns a rotated map around, keeping outlined road names the right way up', () => {
    const p = project();
    // At a half turn the road runs the other way on screen; its name must be reversed so it still reads upright.
    const north = run(p, options()).svg;
    const south = run({ ...p, artboardRotation: 180 }, options()).svg;
    const first = (svg: string) => /<path d="(M[-\d. ]+)/.exec(svg.slice(svg.indexOf('<g id="labels">')))?.[1];
    expect(first(north)).toBeDefined();
    expect(first(south)).toBeDefined();
    expect(first(north)).not.toBe(first(south));
    expect(south).not.toMatch(/NaN/);
  });

  it('escapes text and keeps ids safe', () => {
    const p = project();
    const risky = {
      ...p,
      layers: p.layers.map((l) =>
        l.kind === 'landmarks' ? { ...l, name: 'A&B <x> "q"', pointFeatures: l.pointFeatures.map((f) => ({ ...f, tags: { name: 'Ben & "Jerry" <Ltd>' } })) } : l,
      ),
    };
    const live = run(risky, options({ text: 'live' })).svg;
    expect(live).toContain('Ben &amp; &quot;Jerry&quot; &lt;Ltd&gt;');
    expect(live).toContain('<g id="labels-A-B--x---q-">');
    expect(live).not.toContain('<Ltd>');
  });

  it('embeds the bounds when asked', () => {
    expect(run(project(), options({ embedBBoxMeta: true })).svg).toContain('<!-- bbox: 54.6625,-2.7525,54.6685,-2.7475 -->');
  });

  it('is deterministic', () => {
    const p = project();
    expect(run(p, options()).svg).toBe(run(p, options()).svg);
  });
});
