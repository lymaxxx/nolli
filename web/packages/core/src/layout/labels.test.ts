import { describe, expect, it } from 'vitest';
import type { Point } from '../geo/polyline';
import type { LayerSnapshot, RoadSubLayer } from '../model/layers';
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
import { TextMeasurer, type FontProvider } from '../text/metrics';
import { computeLabelLayout, resolvedText, stitch } from './labels';

const ZOOM = 17;
const latin = notoSans();
const arabic = notoSansArabic();
const provider: FontProvider = { fontsFor: () => [latin, arabic] };
const measurer = new TextMeasurer(provider);

/** Artwork pixels (relative to a fixed origin near Penrith) to a [lon, lat] coordinate. */
const origin = worldPoint(54.66, -2.75, ZOOM);
function lonLat(x: number, y: number): number[] {
  const { lat, lon } = latLonAt({ x: origin.x + x, y: origin.y + y }, ZOOM);
  return [lon, lat];
}
const path = (...points: [number, number][]) => points.map(([x, y]) => lonLat(x, y));

const labelStyle = (over: Partial<LabelStyle> = {}): LabelStyle => ({
  ...DEFAULT_LABEL_STYLE,
  enabled: true,
  tracking: 0,
  fontSize: 20,
  repeatInterval: 100_000,
  ...over,
});

let nextId = 1;
function layer(kind: LayerSnapshot['kind'], over: Partial<LayerSnapshot> = {}): LayerSnapshot {
  const id = `layer-${nextId++}`;
  return {
    id,
    name: kind,
    kind,
    isVisible: true,
    roadStyle: { ...DEFAULT_ROAD_STYLE },
    areaStyle: { ...DEFAULT_AREA_STYLE },
    poiStyle: { ...DEFAULT_POI_STYLE },
    labelStyle: labelStyle(),
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

function roadType(name: string, types: string[], style: LabelStyle): RoadSubLayer {
  return {
    id: `sub-${name}`,
    name,
    roadTypes: types,
    isVisible: true,
    useCustomStyle: false,
    customStyle: { ...DEFAULT_ROAD_STYLE },
    labelStyle: style,
    labelOverrides: new Set(),
    lineOverrides: new Set(),
    useCustomLabelStyle: false,
  };
}

const way = (id: number, name: string, points: [number, number][], highway = 'primary') => ({
  id,
  tags: { highway, name },
  coordinates: path(...points),
});

function roads(
  ways: ReturnType<typeof way>[],
  style = labelStyle(),
  over: Partial<LayerSnapshot> = {},
): LayerSnapshot {
  return layer('roads', {
    labelStyle: style,
    roadSubLayers: [roadType('Primary', ['primary'], style)],
    lineFeatures: ways,
    ...over,
  });
}

const widthOf = (text: string, style = labelStyle()) => measurer.measure(text, style).width;
const run = (layers: LayerSnapshot[]) => computeLabelLayout(layers, ZOOM, 1, measurer);

describe('road names', () => {
  it('centres one label on a straight road when repeats are far apart', () => {
    const layout = run([roads([way(1, 'High Street', [[0, 0], [600, 0]])])]);
    expect(layout.lineLabels).toHaveLength(1);
    const label = layout.lineLabels[0]!;
    expect(label.text).toBe('High Street');
    expect(label.featureId).toBe(1);
    expect(label.centerDist).toBeCloseTo(300, 3);
    expect(label.width).toBeCloseTo(widthOf('High Street'), 8);
    expect(label.pinned).toBe(false);
  });

  it('skips a road no longer than its name plus 4 pixels', () => {
    const w = widthOf('High Street');
    expect(run([roads([way(1, 'High Street', [[0, 0], [w + 3, 0]])])]).lineLabels).toHaveLength(0);
    expect(run([roads([way(1, 'High Street', [[0, 0], [w + 5, 0]])])]).lineLabels).toHaveLength(1);
  });

  it('repeats along a long road at the repeat distance, outwards from the centre', () => {
    const style = labelStyle({ repeatInterval: 300 });
    const w = widthOf('High Street', style);
    const layout = run([roads([way(1, 'High Street', [[0, 0], [2000, 0]])], style)]);
    const centres = layout.lineLabels.map((label) => label.centerDist).sort((a, b) => a - b);
    expect(centres.length).toBeGreaterThanOrEqual(5);
    expect(centres).toContainEqual(expect.closeTo(1000, 3));
    for (let i = 1; i < centres.length; i++) {
      expect(centres[i]! - centres[i - 1]!).toBeGreaterThanOrEqual(300 - 1e-6);
    }
    for (const c of centres) {
      expect(c - w / 2).toBeGreaterThanOrEqual(-1e-6);
      expect(c + w / 2).toBeLessThanOrEqual(2000 + 1e-6);
    }
  });

  it('never straddles a bend sharper than max angle', () => {
    // A right angle at 150 px on a 400 px road: neither leg is long enough for the
    // name unless it avoids the corner, and the longer leg (250) is.
    const style = labelStyle({ maxCharAngle: 25 });
    const w = widthOf('High Street', style);
    expect(w).toBeLessThan(250);
    const layout = run([roads([way(1, 'High Street', [[0, 0], [150, 0], [150, 250]])], style)]);
    expect(layout.lineLabels).toHaveLength(1);
    const label = layout.lineLabels[0]!;
    const corner = 150;
    const start = label.centerDist - w / 2;
    const end = label.centerDist + w / 2;
    expect(start >= corner - 1e-6 || end <= corner + 1e-6).toBe(true);
    expect(start).toBeGreaterThanOrEqual(corner - 1e-6); // the long leg is the second
  });

  it('drops the name when no stretch between sharp bends is long enough', () => {
    const style = labelStyle({ maxCharAngle: 25 });
    const w = widthOf('High Street', style);
    const leg = w / 2 + 10;
    const layout = run([roads([way(1, 'High Street', [[0, 0], [leg, 0], [leg, leg], [2 * leg, leg]])], style)]);
    expect(layout.lineLabels).toHaveLength(0);
  });

  it('lets horizontal labels cross bends', () => {
    const style = labelStyle({ lineLabelMode: 'horizontal' });
    const w = widthOf('High Street', style);
    const leg = w / 2 + 10;
    const layout = run([roads([way(1, 'High Street', [[0, 0], [leg, 0], [leg, leg + 40]])], style)]);
    expect(layout.lineLabels).toHaveLength(1);
  });

  it('stitches ways that continue straight and leaves T-junctions alone', () => {
    const straight = stitch([
      { id: 1, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      { id: 2, points: [{ x: 200, y: 0 }, { x: 100, y: 0 }] }, // runs the other way
    ]);
    expect(straight).toHaveLength(1);
    expect(straight[0]!.id).toBe(1);
    expect(straight[0]!.points.map((p) => p.x)).toEqual([0, 100, 200]);

    const corner = stitch([
      { id: 1, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      { id: 2, points: [{ x: 100, y: 0 }, { x: 100, y: 100 }] },
    ]);
    expect(corner).toHaveLength(2);
  });

  it('labels a street split into ways once, on the joined road', () => {
    const w = widthOf('High Street');
    const half = w * 0.8; // neither way alone fits the name
    const layout = run([
      roads([
        way(10, 'High Street', [[0, 0], [half, 0]]),
        way(11, 'High Street', [[half, 0], [half * 2, 0]]),
      ]),
    ]);
    expect(layout.lineLabels).toHaveLength(1);
    expect(layout.lineLabels[0]!.featureId).toBe(10);
    expect(layout.lineLabels[0]!.centerDist).toBeCloseTo(half, 3);
  });

  it('gates all road names on the master Labels row, and each type on its own flags', () => {
    const ways = [way(1, 'High Street', [[0, 0], [600, 0]])];
    expect(run([roads(ways, labelStyle({ enabled: false }))]).lineLabels).toHaveLength(0);
    expect(run([roads(ways, labelStyle({ isVisible: false }))]).lineLabels).toHaveLength(0);

    const master = labelStyle();
    const hiddenType = layer('roads', {
      labelStyle: master,
      roadSubLayers: [roadType('Primary', ['primary'], labelStyle({ enabled: false }))],
      lineFeatures: ways,
    });
    expect(run([hiddenType]).lineLabels).toHaveLength(0);
  });

  it('uses a road type\'s own label style and scales the font by the label scale', () => {
    const typeStyle = labelStyle({ fontSize: 10 });
    const l = layer('roads', {
      labelStyle: labelStyle({ fontSize: 40 }),
      roadSubLayers: [roadType('Primary', ['primary'], typeStyle)],
      lineFeatures: [way(1, 'High Street', [[0, 0], [600, 0]])],
    });
    const base = computeLabelLayout([l], ZOOM, 1, measurer).lineLabels[0]!;
    expect(base.style.fontSize).toBe(10);
    expect(base.subId).toBe('sub-Primary');
    const scaled = computeLabelLayout([l], ZOOM, 2, measurer).lineLabels[0]!;
    expect(scaled.style.fontSize).toBe(20);
    expect(scaled.width).toBeCloseTo(base.width * 2, 6);
  });

  it('ignores roads whose highway type no road type covers', () => {
    const l = roads([way(1, 'Track Lane', [[0, 0], [600, 0]], 'track')]);
    expect(run([l]).lineLabels).toHaveLength(0);
  });

  it('does not mistake a tag called "constructor" for a missing one', () => {
    const l = roads([
      { id: 1, tags: { highway: 'primary', name: 'Real Name' }, coordinates: path([0, 0], [600, 0]) },
    ]);
    l.labelStyle.tagKey = 'constructor';
    expect(run([l]).lineLabels).toHaveLength(0);
  });
});

describe('collisions and priority', () => {
  // A short road crossing the middle of a long one: too short to slide its name clear.
  const crossing = (a: string, b: string, style = labelStyle()) => {
    const half = widthOf(b, style) / 2 + 8;
    return [way(1, a, [[0, 0], [600, 0]]), way(2, b, [[300, -half], [300, half]])];
  };

  it('drops a label that would overlap one already placed', () => {
    const layout = run([roads(crossing('High Street', 'Low Street'))]);
    // Both centre on (300, 0); only the first claims it, and the second cannot slide clear.
    expect(layout.lineLabels.map((label) => label.featureId)).toEqual([1]);
  });

  it('slides a label along a long road to find a clear spot instead', () => {
    const layout = run([
      roads([way(1, 'High Street', [[0, 0], [600, 0]]), way(2, 'Low Street', [[300, -900], [300, 900]])]),
    ]);
    const second = layout.lineLabels.find((label) => label.featureId === 2);
    expect(second).toBeDefined();
    expect(Math.abs(second!.centerDist - 900)).toBeGreaterThan(20);
  });

  it('keeps both when overlap is allowed', () => {
    const style = labelStyle({ overlapMode: 'allow' });
    expect(run([roads(crossing('High Street', 'Low Street', style), style)]).lineLabels).toHaveLength(2);
    const showAll = labelStyle({ showAllLabels: true });
    expect(run([roads(crossing('High Street', 'Low Street', showAll), showAll)]).lineLabels).toHaveLength(2);
  });

  it('forces the first label of a street when overlap is "allow if required"', () => {
    const style = labelStyle({ overlapMode: 'allow_if_required' });
    const layout = run([roads(crossing('High Street', 'Low Street', style), style)]);
    expect(layout.lineLabels.map((label) => label.featureId).sort()).toEqual([1, 2]);
  });

  it('gives space to the top layer first', () => {
    const half = widthOf('Road Over Water') / 2 + 8;
    const river = () =>
      layer('water', {
        labelStyle: labelStyle(),
        lineFeatures: [{ id: 5, tags: { name: 'The River' }, coordinates: path([0, 0], [600, 0]) }],
      });
    const road = () => roads([way(6, 'Road Over Water', [[300, -half], [300, half]])]);
    // The river is on top and takes the middle; the short road has nowhere to go.
    expect(run([river(), road()]).lineLabels.map((label) => label.featureId)).toEqual([5]);
    // With the road on top it claims the middle first, and the river's name slides aside.
    const roadFirst = run([road(), river()]).lineLabels.map((label) => label.featureId);
    expect(roadFirst[0]).toBe(6);
  });

  it('keeps same-text labels at least the repeat distance apart, across streets', () => {
    const style = labelStyle({ repeatInterval: 500 });
    const l = roads(
      [way(1, 'High Street', [[0, 0], [600, 0]]), way(2, 'High Street', [[0, 300], [600, 300]])],
      style,
    );
    const layout = run([l]);
    const points = layout.lineLabels.map((label) => label.line.pointAt(label.centerDist));
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        expect(Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y)).toBeGreaterThanOrEqual(500 - 1e-6);
      }
    }
  });

  it('respects the margin: a larger one pushes a neighbour away', () => {
    const near = [way(1, 'High Street', [[0, 0], [600, 0]]), way(2, 'Low Street', [[0, 30], [600, 30]])];
    const tight = run([roads(near, labelStyle({ minSpacing: 0 }))]);
    const roomy = run([roads(near, labelStyle({ minSpacing: 60 }))]);
    expect(tight.lineLabels.length).toBeGreaterThanOrEqual(roomy.lineLabels.length);
  });
});

describe('hand-placed labels', () => {
  it('places pinned labels at the pinned distances and suppresses automatic ones', () => {
    const l = roads([way(1, 'High Street', [[0, 0], [1000, 0]])], labelStyle({ repeatInterval: 200 }), {
      labelPins: new Map([[1, [250, 700]]]),
    });
    const layout = run([l]);
    expect(layout.lineLabels.map((label) => label.centerDist)).toEqual([250, 700]);
    expect(layout.lineLabels.every((label) => label.pinned)).toBe(true);
  });

  it('clamps a pin that would hang over the end of the road', () => {
    const w = widthOf('High Street');
    const l = roads([way(1, 'High Street', [[0, 0], [1000, 0]])], labelStyle(), {
      labelPins: new Map([[1, [5]]]),
    });
    expect(run([l]).lineLabels[0]!.centerDist).toBeCloseTo(w / 2, 6);
  });

  it('hides a street whose pin list is empty', () => {
    const l = roads([way(1, 'High Street', [[0, 0], [1000, 0]])], labelStyle(), {
      labelPins: new Map([[1, []]]),
    });
    expect(run([l]).lineLabels).toHaveLength(0);
  });

  it('reserves pinned space before automatic labels anywhere', () => {
    // The automatic label of road 2 would take (300, 0) first if pins did not go earlier.
    const l = roads(
      [way(2, 'Low Street', [[300, -300], [300, 300]]), way(1, 'High Street', [[0, 0], [600, 0]])],
      labelStyle(),
      { labelPins: new Map([[1, [300]]]) },
    );
    const layout = run([l]);
    expect(layout.lineLabels.filter((label) => label.pinned)).toHaveLength(1);
    expect(layout.lineLabels.filter((label) => !label.pinned).every((label) => label.featureId === 2)).toBe(true);
  });

  it('shifts an automatic label by its along-road offset', () => {
    const l = roads([way(1, 'High Street', [[0, 0], [1000, 0]])], labelStyle(), {
      labelAlongOffsets: new Map([[1, 120]]),
    });
    expect(run([l]).lineLabels[0]!.centerDist).toBeCloseTo(620, 3);
  });
});

describe('point and area labels', () => {
  const point = (id: number, name: string, x: number, y: number) => ({
    id,
    tags: { name },
    coordinate: lonLat(x, y),
  });

  it('centres a label on a point and offsets it by the placement', () => {
    const centred = run([layer('landmarks', { pointFeatures: [point(1, 'Museum', 0, 0)] })]);
    expect(centred.pointLabels).toHaveLength(1);
    const c = centred.pointLabels[0]!;
    expect(c.anchor.x).toBeCloseTo(c.featurePoint.x, 6);
    expect(c.anchor.y).toBeCloseTo(c.featurePoint.y, 6);

    const top = run([
      layer('landmarks', {
        labelStyle: labelStyle({ placement: 'top' }),
        pointFeatures: [point(1, 'Museum', 0, 0)],
      }),
    ]).pointLabels[0]!;
    expect(top.anchor.y).toBeLessThan(top.featurePoint.y);
    expect(top.anchor.x).toBeCloseTo(top.featurePoint.x, 6);

    const right = run([
      layer('landmarks', {
        labelStyle: labelStyle({ placement: 'right' }),
        pointFeatures: [point(1, 'Museum', 0, 0)],
      }),
    ]).pointLabels[0]!;
    expect(right.anchor.x).toBeGreaterThan(right.featurePoint.x);
  });

  it('drops the later of two overlapping point labels unless it was moved by hand', () => {
    const points = [point(1, 'Museum', 0, 0), point(2, 'Gallery', 5, 0)];
    expect(run([layer('landmarks', { pointFeatures: points })]).pointLabels.map((l) => l.featureId)).toEqual([1]);
    const moved = layer('landmarks', {
      pointFeatures: points,
      labelOffsets: new Map([[2, [0, 0] as [number, number]]]),
    });
    expect(run([moved]).pointLabels.map((l) => l.featureId)).toEqual([1, 2]);
  });

  it('labels areas at their centroid and skips unnamed ones', () => {
    const ring = [lonLat(0, 0), lonLat(100, 0), lonLat(100, 60), lonLat(0, 60), lonLat(0, 0)] as [number, number][];
    const l = layer('parks', {
      polygonFeatures: [
        { id: 1, tags: { name: 'Town Park' }, rings: [ring] },
        { id: 2, tags: {}, rings: [ring] },
      ],
    });
    const layout = run([l]);
    expect(layout.pointLabels).toHaveLength(1);
    const centre = layout.pointLabels[0]!.featurePoint;
    expect(centre.x - origin.x).toBeCloseTo(50, 0);
    expect(centre.y - origin.y).toBeCloseTo(30, 0);
  });

  it('puts a street also mapped as a named area on the area only', () => {
    const ring = [lonLat(0, 0), lonLat(600, 0), lonLat(600, 40), lonLat(0, 40), lonLat(0, 0)] as [number, number][];
    const l = layer('pedestrian_zones', {
      polygonFeatures: [{ id: 1, tags: { name: 'Market Place' }, rings: [ring] }],
      lineFeatures: [
        { id: 2, tags: { name: 'Market Place' }, coordinates: path([0, 20], [600, 20]) },
        { id: 3, tags: { name: 'Side Walk' }, coordinates: path([0, 200], [600, 200]) },
      ],
    });
    const layout = run([l]);
    expect(layout.pointLabels.map((label) => label.text)).toEqual(['Market Place']);
    expect(layout.lineLabels.map((label) => label.text)).toEqual(['Side Walk']);
  });
});

describe('icons', () => {
  const withIcon = (over: Partial<LayerSnapshot> = {}) =>
    layer('landmarks', {
      symbolStyle: { ...DEFAULT_SYMBOL_STYLE, enabled: true, inlineSVGData: 'PHN2Zy8+', width: 24, height: 24 },
      pointFeatures: [
        { id: 1, tags: { name: 'Museum' }, coordinate: lonLat(0, 0) },
        { id: 2, tags: { name: 'Gallery' }, coordinate: lonLat(10, 0) },
        { id: 3, tags: { name: 'Library' }, coordinate: lonLat(300, 0) },
      ],
      ...over,
    });

  it('places icons that do not collide and drops those that do', () => {
    const layout = run([withIcon()]);
    expect(layout.icons.map((icon) => icon.featureId)).toEqual([1, 3]);
  });

  it('keeps an icon the user moved, wherever it lands', () => {
    const layout = run([withIcon({ symbolOffsets: new Map([[2, [0, 0] as [number, number]]]) })]);
    expect(layout.icons.map((icon) => icon.featureId)).toEqual([1, 2, 3]);
  });

  it('needs an icon source before placing anything', () => {
    const l = withIcon();
    delete l.symbolStyle.inlineSVGData;
    expect(run([l]).icons).toHaveLength(0);
  });

  it('puts a label beside its icon when bound, and clears the icon when not', () => {
    const bound = withIcon({
      symbolStyle: {
        ...DEFAULT_SYMBOL_STYLE,
        enabled: true,
        inlineSVGData: 'PHN2Zy8+',
        bindToLabels: true,
        labelLayout: 'icon_left',
        iconTextGap: 4,
      },
      pointFeatures: [{ id: 1, tags: { name: 'Museum' }, coordinate: lonLat(0, 0) }],
    });
    const label = run([bound]).pointLabels[0]!;
    // Icon on the left means the text sits to the right of the icon centre.
    expect(label.anchor.x).toBeGreaterThan(label.featurePoint.x + 12);

    const unbound = withIcon({ pointFeatures: [{ id: 1, tags: { name: 'Museum' }, coordinate: lonLat(0, 0) }] });
    const free = run([unbound]).pointLabels[0]!;
    // A centred label goes under its icon.
    expect(free.anchor.y).toBeGreaterThan(free.featurePoint.y + 12);
    expect(free.anchor.x).toBeCloseTo(free.featurePoint.x, 6);
  });

  it('places icons before labels, so a label cannot take an icon\'s space', () => {
    const l = layer('landmarks', {
      symbolStyle: { ...DEFAULT_SYMBOL_STYLE, enabled: true, inlineSVGData: 'PHN2Zy8+' },
      pointFeatures: [{ id: 1, tags: { name: 'Museum' }, coordinate: lonLat(0, 0) }],
    });
    const road = roads([way(9, 'High Street', [[-300, 0], [300, 0]])]);
    const layout = run([road, l]);
    expect(layout.icons).toHaveLength(1);
    // The road label would have centred on the icon; it must have moved or been dropped.
    for (const label of layout.lineLabels) {
      const halfWidth = label.width / 2;
      const iconDistance = 300;
      expect(Math.abs(label.centerDist - iconDistance)).toBeGreaterThan(halfWidth * 0.5);
    }
  });
});

describe('joined scripts', () => {
  /** A smooth arc of the given radius, built from many short segments so no vertex is "sharp". */
  function arc(radius: number, degrees: number): [number, number][] {
    const points: [number, number][] = [];
    for (let a = 0; a <= degrees; a += 1) {
      const rad = (a * Math.PI) / 180;
      points.push([radius * Math.sin(rad), radius * (1 - Math.cos(rad))]);
    }
    return points;
  }

  it('lets Latin letters follow a curve but not carry a whole Arabic word round it', () => {
    const text = 'الملك';
    const radius = widthOf(text) / 1.1; // the word would turn about 63 degrees
    const bendy = arc(radius, 180);

    const latinLayout = run([roads([way(1, 'Lines', bendy)])]);
    expect(latinLayout.lineLabels.length).toBeGreaterThanOrEqual(1);

    const arabicLayout = run([roads([way(1, text, bendy)])]);
    expect(arabicLayout.lineLabels).toHaveLength(0);

    // On a gentle curve the same word is fine.
    const gentle = run([roads([way(1, text, arc(radius * 6, 60))])]);
    expect(gentle.lineLabels).toHaveLength(1);
  });
});

describe('text', () => {
  const style = (typeCase: LabelStyle['typeCase']) => labelStyle({ typeCase });

  it('reads the tag, then the fallback tag, and ignores empty text', () => {
    expect(resolvedText({ name: 'Main' }, style('as_stored'))).toBe('Main');
    expect(resolvedText({ 'name:en': 'Main' }, style('as_stored'))).toBe('Main');
    expect(resolvedText({ name: '' }, style('as_stored'))).toBeUndefined();
    expect(resolvedText({}, style('as_stored'))).toBeUndefined();
  });

  it('applies the case rules', () => {
    const tags = { name: 'the old ÉCOLE road' };
    expect(resolvedText(tags, style('uppercase'))).toBe('THE OLD ÉCOLE ROAD');
    expect(resolvedText(tags, style('lowercase'))).toBe('the old école road');
    expect(resolvedText(tags, style('title_case'))).toBe('The Old ÉCOLE Road');
    expect(resolvedText(tags, style('sentence_case'))).toBe('The old ÉCOLE road');
    // The first user-perceived character is capitalised as a unit.
    expect(resolvedText({ name: 'ǆemal' }, style('sentence_case'))).toBe('ǅemal'.replace('ǅ', 'Ǆ'));
  });
});

describe('determinism', () => {
  it('gives the same layout for the same input', () => {
    const l = roads(
      [way(1, 'High Street', [[0, 0], [2000, 0]]), way(2, 'Low Street', [[500, -500], [500, 500]])],
      labelStyle({ repeatInterval: 300 }),
    );
    const key = (layout: ReturnType<typeof run>) =>
      layout.lineLabels.map((label) => `${label.featureId}@${label.centerDist.toFixed(6)}`);
    expect(key(run([l]))).toEqual(key(run([l])));
  });

  it('does not depend on the point the camera looks from', () => {
    // Layout is a function of the document alone: a different measurer instance agrees.
    const l = roads([way(1, 'High Street', [[0, 0], [2000, 0]])], labelStyle({ repeatInterval: 300 }));
    const other = computeLabelLayout([l], ZOOM, 1, new TextMeasurer(provider));
    expect(other.lineLabels.map((label) => label.centerDist)).toEqual(
      run([l]).lineLabels.map((label) => label.centerDist),
    );
  });
});

export type { Point };
