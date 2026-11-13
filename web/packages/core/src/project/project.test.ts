import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadProject, serializeProject, upgradeProject } from './project';

const currentJSON = readFileSync(new URL('./fixtures/macos-v7.json', import.meta.url), 'utf8');
const legacyJSON = readFileSync(
  new URL('./fixtures/macos-v6-sparse.json', import.meta.url),
  'utf8',
);

type JsonObject = Record<string, unknown>;

function legacyData(): JsonObject {
  return JSON.parse(legacyJSON) as JsonObject;
}

function firstLayer(root: JsonObject): JsonObject {
  return (root.layers as JsonObject[])[0]!;
}

function editedLegacy(edit: (root: JsonObject) => void): string {
  const root = legacyData();
  edit(root);
  return JSON.stringify(root);
}

describe('current macOS project files', () => {
  it('loads a JSONEncoder-generated project and round-trips every stored value', () => {
    const project = loadProject(currentJSON);
    const layer = project.layers[0]!;

    expect(project.version).toBe(7);
    expect(project.boundingBox).toEqual({
      minLat: 54.66,
      minLon: -2.76,
      maxLat: 54.67,
      maxLon: -2.74,
    });
    expect(project.cameraZoom).toBe(16.5);
    expect(project.settings.tileOpacity).toBe(1);
    expect(project.textStyles[0]?.name).toBe('Road labels');
    expect(project.colorSchemes?.[0]?.colors['roads|Roads|color']?.b).toBe(0.3);
    expect(project.signOutputs?.[0]).toMatchObject({
      name: 'North entrance',
      isDoubleSided: true,
      backRotation: 220,
      dpi: 600,
    });

    expect(layer.lineFeatures[0]?.coordinates[0]).toEqual([-2.751, 54.664]);
    expect(layer.polygonFeatures[0]?.id).toBe(-87231);
    expect(layer.pointFeatures[0]?.coordinate).toEqual([-2.7505, 54.6645]);
    expect(layer.roadSubLayers[0]?.labelOverrides).toEqual(
      new Set(['tracking', 'fontSize']),
    );
    expect(layer.roadSubLayers[0]?.lineOverrides).toEqual(new Set(['width']));
    expect(layer.labelOffsets).toEqual(
      new Map([
        [65410291, [1.5, -2]],
        [-65410292, [0, 4]],
      ]),
    );
    expect(layer.labelPins.get(-65410292)).toEqual([0, 15.5]);
    expect(layer.labelPins.get(65410291)).toEqual([]);
    expect(layer.originalLineGeometry.get(65410291)?.[0]).toEqual([-2.7511, 54.664]);
    expect(layer.originalPolygonGeometry.get(-87231)?.[0]?.[0]).toEqual([
      -2.7521, 54.663,
    ]);
    expect(layer.originalPointGeometry.get(42)).toEqual([-2.7506, 54.6646]);
    expect(layer.labelStyle.minSpacing).toBe(80);

    const encoded = JSON.parse(serializeProject(project)) as unknown;
    expect(encoded).toEqual(JSON.parse(currentJSON));
  });
});

describe('legacy project upgrading', () => {
  it('matches Swift defaults and the version 7 margin migration', () => {
    const project = loadProject(legacyJSON);
    const layer = project.layers[0]!;
    const generatedSubLayer = layer.roadSubLayers[0]!;
    const existingSubLayer = layer.roadSubLayers[1]!;

    expect(project.version).toBe(6);
    expect(project.settings).toMatchObject({
      defaultFont: 'Fira Sans',
      cacheDurationDays: 7,
      defaultExportFormat: 'SVG',
      overpassEndpoint: 'https://overpass.openstreetmap.fr/api/interpreter',
      tileOpacity: 1,
    });
    expect(project.iconLibrary).toEqual([]);
    expect(project.textStyles).toEqual([]);
    expect(project.artboardRotation).toBe(0);
    expect(project.baseZoom).toBe(15);
    expect(project.signArtworkScale).toBe(1);

    expect(layer.labelStyle).toMatchObject({
      fontName: 'Fira Sans',
      minSpacing: 6,
      tracking: 20,
      repeatInterval: 200,
      uppercase: false,
    });
    expect(layer.areaStyle).toMatchObject({ fillOpacity: 0.8, strokeWidth: 1 });
    expect(layer.symbolStyle).toMatchObject({
      enabled: false,
      width: 24,
      anchorPoint: 'geometric_center',
    });
    expect(layer.lineFeatures).toHaveLength(1);
    expect(layer.polygonFeatures).toEqual([]);
    expect(layer.pointFeatures).toEqual([]);

    expect(generatedSubLayer.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(generatedSubLayer.labelStyle?.minSpacing).toBe(6);
    expect(generatedSubLayer.customStyle.width).toBe(2);
    expect(existingSubLayer).toMatchObject({
      id: '00000000-0000-4000-8000-000000000008',
      name: 'Primary',
      roadTypes: ['primary'],
      useCustomStyle: false,
      useCustomLabelStyle: false,
    });
    expect(existingSubLayer.customStyle).toMatchObject({ width: 4, lineCap: 'round' });
    expect(existingSubLayer.labelStyle?.minSpacing).toBe(30);
    expect(existingSubLayer.labelOverrides).toBeUndefined();
    expect(existingSubLayer.lineOverrides).toBeUndefined();

    for (const dictionary of [
      layer.labelOffsets,
      layer.labelAlongOffsets,
      layer.labelPins,
      layer.symbolOffsets,
      layer.originalLineGeometry,
      layer.originalPolygonGeometry,
      layer.originalPointGeometry,
    ]) {
      expect(dictionary.size).toBe(0);
    }

    expect(project.signOutputs?.[0]).toMatchObject({
      name: 'Sign',
      lat: 54.6645,
      lon: -2.7505,
      dpi: 300,
      labelScale: 1,
      iconScale: 1,
      centerOffsetLat: 0,
      centerOffsetLon: 0,
    });
  });

  it('treats a missing version as pre-7 but preserves custom and future margins', () => {
    const withoutVersion = editedLegacy((root) => {
      delete root.version;
    });
    expect(loadProject(withoutVersion).layers[0]?.labelStyle.minSpacing).toBe(6);

    const customMargin = editedLegacy((root) => {
      (firstLayer(root).labelStyle as JsonObject).minSpacing = 79;
    });
    expect(loadProject(customMargin).layers[0]?.labelStyle.minSpacing).toBe(79);

    const future = JSON.parse(currentJSON) as JsonObject;
    future.version = 8;
    const futureProject = loadProject(JSON.stringify(future));
    expect(futureProject.version).toBe(8);
    expect(futureProject.layers[0]?.labelStyle.minSpacing).toBe(80);
  });

  it('replaces a heterogeneous roadSubLayers value as Swift does', () => {
    const project = loadProject(
      editedLegacy((root) => {
        firstLayer(root).roadSubLayers = [{ name: 'Valid' }, 'invalid'];
      }),
    );

    expect(project.layers[0]?.roadSubLayers).toEqual([]);
  });

  it('keeps absent and explicitly empty override sets distinct', () => {
    const project = loadProject(
      editedLegacy((root) => {
        const subLayers = firstLayer(root).roadSubLayers as JsonObject[];
        subLayers[0]!.labelOverrides = [];
        subLayers[0]!.lineOverrides = [];
      }),
    );
    const subLayer = project.layers[0]?.roadSubLayers[0];

    expect(subLayer?.labelOverrides).toEqual(new Set());
    expect(subLayer?.lineOverrides).toEqual(new Set());
    const encoded = JSON.parse(serializeProject(project)) as JsonObject;
    const encodedSubLayer = firstLayer(encoded).roadSubLayers as JsonObject[];
    expect(encodedSubLayer[0]?.labelOverrides).toEqual([]);
    expect(encodedSubLayer[0]?.lineOverrides).toEqual([]);
  });
});

describe('save normalisation', () => {
  it('is stable after the first load/save pass and omits empty edit dictionaries', () => {
    const firstSave = serializeProject(loadProject(legacyJSON));
    const secondSave = serializeProject(loadProject(firstSave));
    expect(secondSave).toBe(firstSave);

    const encoded = JSON.parse(firstSave) as JsonObject;
    const layer = firstLayer(encoded);
    for (const key of [
      'labelOffsets',
      'labelAlongOffsets',
      'labelPins',
      'symbolOffsets',
      'originalLineGeometry',
      'originalPolygonGeometry',
      'originalPointGeometry',
    ]) {
      expect(layer).not.toHaveProperty(key);
    }
  });

  it('omits optional nulls and upgrades the version', () => {
    const project = loadProject(
      editedLegacy((root) => {
        root.colorSwatches = null;
      }),
    );
    const encoded = JSON.parse(serializeProject(project)) as JsonObject;

    expect(encoded.version).toBe(7);
    expect(encoded).not.toHaveProperty('colorSwatches');
  });

  it('keeps keys this version does not know, at every level, through a save', () => {
    // A newer macOS build may write fields the web app has not heard of. The
    // macOS decoder would drop them; the web app keeps them so nothing is lost
    // by passing a file through it.
    const project = loadProject(
      editedLegacy((root) => {
        root.unknownFutureField = { keep: true };
        const layer = firstLayer(root);
        layer.unknownLayerField = 42;
        (layer.roadStyle as JsonObject).unknownStyleField = 'x';
        (layer.lineFeatures as JsonObject[])[0]!.unknownFeatureField = [1, 2];
      }),
    );
    const encoded = JSON.parse(serializeProject(project)) as JsonObject;
    const layer = firstLayer(encoded);

    expect(encoded.unknownFutureField).toEqual({ keep: true });
    expect(layer.unknownLayerField).toBe(42);
    expect((layer.roadStyle as JsonObject).unknownStyleField).toBe('x');
    expect((layer.lineFeatures as JsonObject[])[0]!.unknownFeatureField).toEqual([1, 2]);

    // And a second pass changes nothing.
    const again = JSON.parse(serializeProject(loadProject(JSON.stringify(encoded)))) as JsonObject;
    expect(again).toEqual(encoded);
  });
});

describe('validation matches Codable boundaries', () => {
  it('does not recursively fill partial colour objects', () => {
    const json = editedLegacy((root) => {
      firstLayer(root).roadStyle = {
        color: { r: 0.2, g: 0.2, b: 0.2 },
        width: 2,
      };
    });

    expect(() => loadProject(json)).toThrow();
  });

  it('does not invent missing style containers or fill partial library records', () => {
    const noStyle = editedLegacy((root) => {
      delete firstLayer(root).roadStyle;
    });
    const partialIcon = editedLegacy((root) => {
      root.iconLibrary = [{ name: 'Missing its data' }];
    });
    const partialBoundingBox = editedLegacy((root) => {
      root.boundingBox = { minLat: 1, maxLat: 2, maxLon: 3 };
    });

    expect(() => loadProject(noStyle)).toThrow();
    expect(() => loadProject(partialIcon)).toThrow();
    expect(() => loadProject(partialBoundingBox)).toThrow();
  });

  it('rejects malformed JSON, nonoptional nulls and unknown enum values', () => {
    const nullSettings = editedLegacy((root) => {
      root.settings = null;
    });
    const unknownKind = editedLegacy((root) => {
      firstLayer(root).kind = 'railways';
    });

    expect(() => loadProject('{ nope')).toThrow(SyntaxError);
    expect(() => loadProject(nullSettings)).toThrow();
    expect(() => loadProject(unknownKind)).toThrow();
  });

  it('does not mutate input passed to the upgrader or share parsed defaults', () => {
    const input = legacyData();
    const original = structuredClone(input);
    upgradeProject(input);
    expect(input).toEqual(original);

    const first = loadProject(legacyJSON);
    first.layers[0]!.labelStyle.tracking = 999;
    const second = loadProject(legacyJSON);
    expect(second.layers[0]?.labelStyle.tracking).toBe(20);
  });
});
