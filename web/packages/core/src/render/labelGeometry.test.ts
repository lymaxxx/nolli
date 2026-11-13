import { describe, expect, it } from 'vitest';
import { computeLabelLayout, type PlacedLineLabel } from '../layout/labels';
import type { LayerSnapshot } from '../model/layers';
import {
  DEFAULT_AREA_STYLE,
  DEFAULT_LABEL_STYLE,
  DEFAULT_POI_STYLE,
  DEFAULT_ROAD_STYLE,
  DEFAULT_SYMBOL_STYLE,
  type LabelStyle,
} from '../model/styles';
import { latLonAt, worldPoint } from '../projection/projection';
import { notoSans, notoSansArabic } from '../testing/fonts';
import { TextMeasurer } from '../text/metrics';
import { baselineShift, buildLineLabel, buildPointLabel } from './labelGeometry';

const ZOOM = 17;
const measurer = new TextMeasurer({ fontsFor: () => [notoSans(), notoSansArabic()] });
const origin = worldPoint(54.66, -2.75, ZOOM);
const lonLat = (x: number, y: number): number[] => {
  const { lat, lon } = latLonAt({ x: origin.x + x, y: origin.y + y }, ZOOM);
  return [lon, lat];
};

const style = (over: Partial<LabelStyle> = {}): LabelStyle => ({
  ...DEFAULT_LABEL_STYLE,
  enabled: true,
  tracking: 0,
  fontSize: 20,
  repeatInterval: 100_000,
  ...over,
});

function baseLayer(kind: LayerSnapshot['kind'], over: Partial<LayerSnapshot>): LayerSnapshot {
  return {
    id: 'L',
    name: kind,
    kind,
    isVisible: true,
    roadStyle: { ...DEFAULT_ROAD_STYLE },
    areaStyle: { ...DEFAULT_AREA_STYLE },
    poiStyle: { ...DEFAULT_POI_STYLE },
    labelStyle: style(),
    symbolStyle: { ...DEFAULT_SYMBOL_STYLE },
    roadSubLayers: [],
    lineFeatures: [],
    polygonFeatures: [],
    pointFeatures: [],
    labelOffsets: new Map(),
    labelAlongOffsets: new Map(),
    labelPins: new Map(),
    symbolOffsets: new Map(),
    originalLineGeometry: new Map(),
    originalPolygonGeometry: new Map(),
    originalPointGeometry: new Map(),
    ...over,
  };
}

/** A water layer holds plain lines, so the label style applies without road-type plumbing. */
function lineLabelFor(text: string, points: [number, number][], labelStyle: LabelStyle): PlacedLineLabel {
  const layer = baseLayer('water', {
    labelStyle: labelStyle,
    lineFeatures: [{ id: 1, tags: { name: text }, coordinates: points.map(([x, y]) => lonLat(x, y)) }],
  });
  const layout = computeLabelLayout([layer], ZOOM, 1, measurer);
  expect(layout.lineLabels).toHaveLength(1);
  return layout.lineLabels[0]!;
}

const east: [number, number][] = [[0, 0], [600, 0]];

describe('baselineShift', () => {
  const metrics = measurer.measure('Hello', { fontName: 'x', fontWeight: 'Regular', fontSize: 20, tracking: 0, wordSpacing: 0 });
  it('puts the baseline above, on, or below the line', () => {
    const above = baselineShift(style({ linePosition: 'above', distanceFromLine: 3 }), metrics);
    const on = baselineShift(style({ linePosition: 'on' }), metrics);
    const below = baselineShift(style({ linePosition: 'below', distanceFromLine: 3 }), metrics);
    expect(above).toBeCloseTo(3 + metrics.descent, 8);
    expect(on).toBeCloseTo(-(metrics.ascent - metrics.descent) / 2, 8);
    expect(below).toBeCloseTo(-(3 + metrics.ascent), 8);
    expect(above).toBeGreaterThan(0);
    expect(below).toBeLessThan(0);
  });
});

describe('curved labels', () => {
  const placed = lineLabelFor('High Street', east, style({ linePosition: 'above', distanceFromLine: 2 }));
  const geometry = buildLineLabel(placed, 0, placed.centerDist, origin);

  it('draws one glyph per letter, skipping the space, left to right along the road', () => {
    expect(geometry.forward.glyphs).toHaveLength('HighStreet'.length);
    const xs = geometry.forward.glyphs.map((glyph) => glyph.matrix.e);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it('keeps level text level and shifts it above the road', () => {
    const shift = baselineShift(placed.style, placed.metrics);
    for (const glyph of geometry.forward.glyphs) {
      const m = glyph.matrix;
      expect(m.b).toBeCloseTo(0, 8);
      expect(m.a).toBeGreaterThan(0);
      expect(m.d).toBeLessThan(0); // y flipped from font units
      expect(m.f).toBeCloseTo(-shift, 6); // road is at local y = 0 here
    }
  });

  it('centres the text on the label centre', () => {
    const glyphs = geometry.forward.glyphs;
    const first = glyphs[0]!.matrix.e;
    const last = glyphs[glyphs.length - 1]!.matrix.e;
    const centre = placed.line.pointAt(placed.centerDist).x - origin.x;
    expect((first + last) / 2).toBeGreaterThan(centre - 20);
    expect((first + last) / 2).toBeLessThan(centre + 20);
  });

  it('has a reverse run that reads the other way round', () => {
    const reverse = geometry.reverse!;
    expect(reverse.glyphs).toHaveLength(geometry.forward.glyphs.length);
    for (const glyph of reverse.glyphs) expect(glyph.matrix.a).toBeLessThan(0);
    // It sits on the other side of the road, so it still reads as "above" once turned over.
    expect(reverse.glyphs[0]!.matrix.f).toBeGreaterThan(0);
  });

  it('records the road direction under the label', () => {
    expect(geometry.chord).toBeCloseTo(0, 8);
    expect(geometry.upright).toBe(false);
    expect(geometry.bounds.width).toBeGreaterThan(placed.width);
  });

  it('rotates glyphs with a bend', () => {
    const bent = lineLabelFor('Corner Rd', [[0, 0], [100, 0], [100, 100]], style({ maxCharAngle: 100 }));
    const g = buildLineLabel(bent, 0, bent.centerDist, origin);
    const angles = g.forward.glyphs.map((glyph) => Math.atan2(glyph.matrix.b, glyph.matrix.a));
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(0.3);
  });
});

describe('other modes', () => {
  it('keeps horizontal labels upright, drawn around the anchor', () => {
    const placed = lineLabelFor('High Street', east, style({ lineLabelMode: 'horizontal' }));
    const g = buildLineLabel(placed, 0, placed.centerDist, origin);
    expect(g.upright).toBe(true);
    expect(g.reverse).toBeUndefined();
    const xs = g.forward.glyphs.map((glyph) => glyph.matrix.e);
    expect(Math.min(...xs)).toBeLessThan(0);
    expect(Math.max(...xs)).toBeGreaterThan(0);
    expect(g.anchor.x).toBeCloseTo(300, 3);
  });

  it('rotates parallel labels to the road and offers the half-turned reverse', () => {
    const placed = lineLabelFor('High Street', [[0, 0], [400, 400]], style({ lineLabelMode: 'parallel' }));
    const g = buildLineLabel(placed, 0, placed.centerDist, origin);
    expect(g.upright).toBe(false);
    const forward = g.forward.glyphs[0]!.matrix;
    expect(Math.atan2(forward.b, forward.a)).toBeCloseTo(Math.PI / 4, 6);
    const reverse = g.reverse!.glyphs[0]!.matrix;
    expect(Math.abs(Math.atan2(reverse.b, reverse.a))).toBeCloseTo((3 * Math.PI) / 4, 6);
  });
});

describe('joined scripts', () => {
  it('draws an Arabic word as one rigid piece: every letter of it shares one rotation', () => {
    const placed = lineLabelFor('الملك', [[0, 0], [300, 100]], style({ lineLabelMode: 'curved' }));
    const g = buildLineLabel(placed, 0, placed.centerDist, origin);
    const angles = new Set(g.forward.glyphs.map((glyph) => Math.atan2(glyph.matrix.b, glyph.matrix.a).toFixed(9)));
    expect(angles.size).toBe(1);
    expect(g.forward.glyphs.length).toBeGreaterThan(1);
  });
});

describe('point labels', () => {
  it('centres the text on the anchor and has no callout when the label is on its feature', () => {
    const layer = baseLayer('landmarks', {
      pointFeatures: [{ id: 1, tags: { name: 'Museum' }, coordinate: lonLat(0, 0) }],
    });
    const placed = computeLabelLayout([layer], ZOOM, 1, measurer).pointLabels[0]!;
    const g = buildPointLabel(placed, origin);
    expect(g.upright).toBe(true);
    expect(g.callout).toBeUndefined();
    expect(g.anchor.x).toBeCloseTo(0, 3);
    const xs = g.forward.glyphs.map((glyph) => glyph.matrix.e);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeLessThan(5);
  });

  it('adds a callout when the label sits away from its feature', () => {
    const layer = baseLayer('landmarks', {
      labelStyle: style({ calloutsEnabled: true, calloutMinDistance: 4, placement: 'top_right' }),
      pointFeatures: [{ id: 1, tags: { name: 'Museum' }, coordinate: lonLat(0, 0) }],
    });
    const placed = computeLabelLayout([layer], ZOOM, 1, measurer).pointLabels[0]!;
    const g = buildPointLabel(placed, origin);
    expect(g.callout).toBeDefined();
    expect(g.callout!.x).toBeCloseTo(0, 3);
    expect(g.bounds.x).toBeLessThanOrEqual(g.callout!.x);
  });
});
