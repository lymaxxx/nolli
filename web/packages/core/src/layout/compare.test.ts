import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadProject } from '../project/project';
import { notoSans } from '../testing/fonts';
import { TextMeasurer } from '../text/metrics';
import { FontRegistry } from '../text/registry';
import { compareLayouts, type LayoutDump } from './compare';
import { computeLabelLayout, type MapLabelLayout, type PlacedLineLabel } from './labels';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

const line = (over: Partial<PlacedLineLabel> = {}): PlacedLineLabel =>
  ({
    layerId: 'abc',
    featureId: 1,
    text: 'High Street',
    centerDist: 300,
    width: 100,
    pinned: false,
    ...over,
  }) as PlacedLineLabel;

const dump = (over: Partial<LayoutDump> = {}): LayoutDump => ({
  version: 1,
  baseZoom: 17,
  labelScale: 1,
  lineLabels: [
    { layerId: 'ABC', featureId: 1, text: 'High Street', centerDist: 300, width: 100, pinned: false, fontSize: 9, line: [] },
  ],
  pointLabels: [],
  icons: [],
  ...over,
});

const layout = (lineLabels: PlacedLineLabel[]): MapLabelLayout => ({ lineLabels, pointLabels: [], icons: [] });

describe('compareLayouts', () => {
  it('matches identical layouts, ignoring the case of layer ids', () => {
    const result = compareLayouts(dump(), layout([line()]));
    expect(result).toMatchObject({ matched: 1, identical: true });
  });

  it('accepts differences within the tolerance and flags larger ones', () => {
    expect(compareLayouts(dump(), layout([line({ centerDist: 301.5 })]), 2).identical).toBe(true);
    const far = compareLayouts(dump(), layout([line({ centerDist: 310 })]), 2);
    expect(far.identical).toBe(false);
    expect(far.moved).toHaveLength(1);
    expect(far.moved[0]!.detail).toMatch(/10\.0 px/);
  });

  it('reports labels the web app dropped and ones it added', () => {
    const missing = compareLayouts(dump(), layout([]));
    expect(missing.missing).toHaveLength(1);
    const extra = compareLayouts(dump({ lineLabels: [] }), layout([line()]));
    expect(extra.extra).toHaveLength(1);
  });

  it('matches repeated labels of one street in order along it', () => {
    const d = dump({
      lineLabels: [
        { layerId: 'abc', featureId: 1, text: 'High Street', centerDist: 600, width: 100, pinned: false, fontSize: 9, line: [] },
        { layerId: 'abc', featureId: 1, text: 'High Street', centerDist: 200, width: 100, pinned: false, fontSize: 9, line: [] },
      ],
    });
    const result = compareLayouts(d, layout([line({ centerDist: 200 }), line({ centerDist: 600 })]));
    expect(result).toMatchObject({ matched: 2, identical: true });
  });

  it('compares point labels and icons by position', () => {
    const d = dump({
      lineLabels: [],
      pointLabels: [{ layerId: 'abc', featureId: 7, text: 'Museum', anchor: [10, 20], featurePoint: [10, 20] }],
      icons: [{ layerId: 'abc', featureId: 7, point: [10, 20] }],
    });
    const same: MapLabelLayout = {
      lineLabels: [],
      pointLabels: [{ layerId: 'abc', featureId: 7, text: 'Museum', anchor: { x: 10.5, y: 20 } }] as never,
      icons: [{ layerId: 'abc', featureId: 7, point: { x: 10, y: 20 } }],
    };
    expect(compareLayouts(d, same).identical).toBe(true);
    const off: MapLabelLayout = { ...same, icons: [{ layerId: 'abc', featureId: 7, point: { x: 30, y: 20 } }] };
    expect(compareLayouts(d, off).moved).toHaveLength(1);
  });

  it('matches the macOS LabelLayoutEngine dump for a multi-layer Noto Sans fixture within 0.5 px', () => {
    const project = loadProject(readFileSync(path.join(fixturesDir, 'macos-noto-project.json'), 'utf8'));
    const expected = JSON.parse(readFileSync(path.join(fixturesDir, 'macos-noto-dump.json'), 'utf8')) as LayoutDump;
    const font = notoSans();
    const registry = new FontRegistry({ regular: [font], bold: [font] });
    registry.add('Noto Sans', 'Regular', font);
    const actual = computeLabelLayout(project.layers, project.baseZoom, 1, new TextMeasurer(registry));

    const comparison = compareLayouts(expected, actual, 0.5);
    expect(comparison).toEqual({
      matched: 7,
      missing: [],
      extra: [],
      moved: [],
      identical: true,
    });
  });
});
