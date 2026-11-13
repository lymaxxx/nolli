import { describe, expect, it } from 'vitest';
import {
  roadSubLayerDefaults,
  type LayerSnapshot,
  type RoadSubLayer,
} from '../model/layers';
import {
  DEFAULT_AREA_STYLE,
  DEFAULT_LABEL_STYLE,
  DEFAULT_POI_STYLE,
  DEFAULT_ROAD_STYLE,
  DEFAULT_SYMBOL_STYLE,
} from '../model/styles';
import { projectionOf, worldPoint } from '../projection/projection';
import {
  cellIntersects,
  compileScene,
  cssColor,
  featureKind,
  sceneCullRect,
} from './scene';

const BASE_ZOOM = 17;

function layer(
  partial: Pick<LayerSnapshot, 'id' | 'name' | 'kind'> & Partial<LayerSnapshot>,
): LayerSnapshot {
  return {
    isVisible: true,
    roadStyle: { ...DEFAULT_ROAD_STYLE },
    areaStyle: { ...DEFAULT_AREA_STYLE },
    poiStyle: { ...DEFAULT_POI_STYLE },
    labelStyle: { ...DEFAULT_LABEL_STYLE },
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
    ...partial,
  };
}

function subLayer(partial: Partial<RoadSubLayer> & Pick<RoadSubLayer, 'id' | 'name'>): RoadSubLayer {
  return {
    ...roadSubLayerDefaults(partial.id),
    ...partial,
  };
}

function sampleLayers(): LayerSnapshot[] {
  return [
    layer({
      id: 'transport',
      name: 'Transport',
      kind: 'transport',
      pointFeatures: [
        { id: 101, tags: { railway: 'station' }, coordinate: [-2.75, 54.66] },
        { id: 102, tags: { amenity: 'bus_station' }, coordinate: [-2.749, 54.661] },
      ],
      poiStyle: { ...DEFAULT_POI_STYLE, size: 10 },
    }),
    layer({
      id: 'roads',
      name: 'Roads',
      kind: 'roads',
      roadStyle: { ...DEFAULT_ROAD_STYLE, width: 1, color: { r: 0.2, g: 0.2, b: 0.2, a: 1 } },
      lineFeatures: [
        {
          id: 1,
          tags: { highway: 'primary' },
          coordinates: [
            [-2.75, 54.66],
            [-2.749, 54.661],
          ],
        },
        {
          id: 2,
          tags: { highway: 'residential' },
          coordinates: [
            [-2.75, 54.66],
            [-2.751, 54.66],
          ],
        },
        {
          id: 3,
          tags: {},
          coordinates: [
            [-2.75, 54.66],
            [-2.75, 54.662],
          ],
        },
      ],
      roadSubLayers: [
        subLayer({ id: 'primary', name: 'Primary', roadTypes: ['primary'] }),
        subLayer({
          id: 'local',
          name: 'Local',
          roadTypes: ['residential'],
          useCustomStyle: true,
          customStyle: { ...DEFAULT_ROAD_STYLE, width: 5, color: { r: 1, g: 0, b: 0, a: 1 } },
          lineOverrides: new Set(['width']),
        }),
      ],
    }),
    layer({
      id: 'water',
      name: 'Water',
      kind: 'water',
      areaStyle: { ...DEFAULT_AREA_STYLE, fillColor: { r: 0, g: 0, b: 1, a: 1 } },
      polygonFeatures: [
        {
          id: 201,
          tags: {},
          rings: [
            [
              [-2.752, 54.659],
              [-2.748, 54.659],
              [-2.748, 54.662],
              [-2.752, 54.662],
            ],
          ],
        },
        {
          id: 202,
          tags: {},
          rings: [
            [
              [-2.755, 54.655],
              [-2.744, 54.655],
              [-2.744, 54.665],
              [-2.755, 54.665],
            ],
            [
              [-2.752, 54.658],
              [-2.748, 54.658],
              [-2.748, 54.662],
              [-2.752, 54.662],
            ],
          ],
        },
      ],
      lineFeatures: [
        {
          id: 203,
          tags: { waterway: 'river' },
          coordinates: [
            [-2.753, 54.657],
            [-2.752, 54.658],
          ],
        },
      ],
    }),
    layer({
      id: 'background',
      name: 'Background',
      kind: 'background',
      polygonFeatures: [
        {
          id: 301,
          tags: {},
          rings: [
            [
              [-2.76, 54.65],
              [-2.74, 54.65],
              [-2.74, 54.67],
              [-2.76, 54.67],
            ],
          ],
        },
      ],
    }),
  ];
}

describe('feature kinds', () => {
  it('matches the macOS layer kinds', () => {
    expect(featureKind('roads')).toBe('line');
    expect(featureKind('water')).toBe('polygon');
    expect(featureKind('background')).toBe('polygon');
    expect(featureKind('transport')).toBe('point');
    expect(featureKind('education')).toBe('point');
  });
});

describe('scene compilation', () => {
  it('paints bottom layers first and top sublayer rows last', () => {
    const scene = compileScene(sampleLayers(), BASE_ZOOM);
    const ids = scene.batches.map((batch) => `${batch.layerId}:${batch.subLayerId ?? ''}`);

    expect(ids).toEqual([
      'background:',
      'water:',
      'water:',
      'water:',
      'roads:local',
      'roads:primary',
    ]);
    const roads = scene.batches.filter((batch) => batch.layerId === 'roads');
    expect(roads[0]?.lineWidth).toBe(5);
    expect(roads[0]?.stroke).toBe('rgba(255, 0, 0, 1)');
    expect(roads[1]?.lineWidth).toBe(1);
  });

  it('keeps each feature in artwork space relative to one origin', () => {
    const scene = compileScene(sampleLayers(), BASE_ZOOM);
    const expectedOrigin = worldPoint(54.66, -2.75, BASE_ZOOM);
    expect(scene.origin).toEqual({
      x: Math.round(expectedOrigin.x),
      y: Math.round(expectedOrigin.y),
    });
    expect(scene.baseZoom).toBe(BASE_ZOOM);

    const marker = scene.markers[0]?.markers[0];
    expect(marker?.id).toBe(101);
    expect(marker?.x).toBeCloseTo(expectedOrigin.x - scene.origin.x, 9);
    expect(marker?.y).toBeCloseTo(expectedOrigin.y - scene.origin.y, 9);
  });

  it('filters roads by sublayer types and ignores untagged ways', () => {
    const scene = compileScene(sampleLayers(), BASE_ZOOM);
    const roads = scene.batches.filter((batch) => batch.layerId === 'roads');
    const pathCount = roads.map((batch) =>
      batch.cells.reduce((total, cell) => total + cell.paths.length, 0),
    );
    expect(pathCount).toEqual([1, 1]);
  });

  it('uses even-odd filling for polygons with holes', () => {
    const scene = compileScene(sampleLayers(), BASE_ZOOM);
    const water = scene.batches.filter((batch) => batch.layerId === 'water');
    expect(water).toHaveLength(3);
    expect(water[0]?.evenOdd).toBeUndefined();
    expect(water[1]?.evenOdd).toBe(true);
    expect(water[1]?.cells[0]?.paths[0]).toMatchObject({ kind: 'polygon' });
    expect(water[2]?.stroke).toBe('rgba(0, 0, 255, 0.8)');
    expect(water[2]?.lineWidth).toBe(2);
  });

  it('counts visible features and skips hidden layers', () => {
    const layers = sampleLayers();
    expect(compileScene(layers, BASE_ZOOM).featureCount).toBe(9);
    layers[2]!.isVisible = false;
    const hidden = compileScene(layers, BASE_ZOOM);
    expect(hidden.featureCount).toBe(6);
    expect(hidden.batches.some((batch) => batch.layerId === 'water')).toBe(false);
  });

  it('culls cells outside the artwork-space view', () => {
    const scene = compileScene(sampleLayers(), BASE_ZOOM);
    const projection = projectionOf(
      { centerLat: 54.66, centerLon: -2.75, zoom: BASE_ZOOM, rotation: 17 },
      { width: 800, height: 600 },
    );
    const cull = sceneCullRect(scene, projection);
    expect(cull.x).toBeLessThan(0);
    expect(cull.x + cull.width).toBeGreaterThan(0);

    const near = scene.batches[0]?.cells[0];
    expect(near && cellIntersects(near, cull)).toBe(true);
    expect(cellIntersects({ bounds: { x: 1e6, y: 1e6, width: 10, height: 10 }, paths: [] }, cull)).toBe(
      false,
    );
  });

  it('keeps point markers in layer order instead of hoisting them', () => {
    const layers = sampleLayers();
    const roads = layers.find((item) => item.id === 'roads')!;
    const transport = layers.find((item) => item.id === 'transport')!;
    const scene = compileScene([roads, transport], BASE_ZOOM);

    const markerSequence = scene.markers[0]!.sequence;
    const firstRoadSequence = Math.min(...scene.batches.map((batch) => batch.sequence));
    expect(markerSequence).toBeLessThan(firstRoadSequence);
  });

  it('formats colours with the style alpha', () => {
    expect(cssColor({ r: 0.5, g: 0.25, b: 1, a: 0.5 }, 0.5)).toBe('rgba(128, 64, 255, 0.25)');
    expect(cssColor({ r: 2, g: -1, b: 0, a: 2 })).toBe('rgba(255, 0, 0, 1)');
  });
});
