import { flattenInt64Dictionary } from '../model/int64Dictionary';
import { LAYER_STYLE_DEFAULTS, roadSubLayerDefaults, type LayerSnapshot } from '../model/layers';
import {
  CURRENT_PROJECT_VERSION,
  DEFAULT_APP_SETTINGS,
  DEFAULT_PROJECT_FIELDS,
  ProjectSnapshotSchema,
  signOutputDefaults,
  type ProjectSnapshot,
} from '../model/project';
import { DEFAULT_LABEL_STYLE, DEFAULT_ROAD_STYLE } from '../model/styles';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** JSONSerialization's dictionary[key] == nil means absent, not explicit null. */
function fillMissing(target: JsonObject, defaults: object): void {
  for (const [key, value] of Object.entries(defaults)) {
    if (target[key] === undefined && value !== undefined) target[key] = value;
  }
}

/** ProjectManager fills one level inside a child, not arbitrary nested objects. */
function fillChild(target: JsonObject, key: string, defaults: object): void {
  const child = target[key];
  if (!isObject(child)) return;
  const upgraded = { ...child };
  fillMissing(upgraded, defaults);
  target[key] = upgraded;
}

/** UUID-only use; project ids are identifiers, not security tokens. */
function newUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function migrateMargin(layer: JsonObject, fileVersion: number): void {
  if (fileVersion >= 7) return;
  const labelStyle = layer.labelStyle;
  if (isObject(labelStyle) && labelStyle.minSpacing === 80) {
    layer.labelStyle = { ...labelStyle, minSpacing: DEFAULT_LABEL_STYLE.minSpacing };
  }
}

/** A direct TypeScript counterpart of ProjectManager.upgraded in the macOS app. */
export function upgradeProject(input: unknown): unknown {
  if (!isObject(input)) return input;

  const root = { ...input };
  const fileVersion =
    typeof root.version === 'number' && Number.isInteger(root.version) ? root.version : 0;

  fillMissing(root, DEFAULT_PROJECT_FIELDS);
  fillChild(root, 'settings', DEFAULT_APP_SETTINGS);

  if (Array.isArray(root.layers) && root.layers.every(isObject)) {
    root.layers = root.layers.map((originalLayer) => {
      const layer = { ...originalLayer };
      migrateMargin(layer, fileVersion);
      for (const [key, defaults] of Object.entries(LAYER_STYLE_DEFAULTS)) {
        fillChild(layer, key, defaults);
      }
      for (const key of ['lineFeatures', 'polygonFeatures', 'pointFeatures']) {
        if (layer[key] === undefined) layer[key] = [];
      }

      if (Array.isArray(layer.roadSubLayers) && layer.roadSubLayers.every(isObject)) {
        layer.roadSubLayers = layer.roadSubLayers.map((originalSubLayer) => {
          const subLayer = { ...originalSubLayer };
          migrateMargin(subLayer, fileVersion);
          fillMissing(subLayer, roadSubLayerDefaults(newUUID()));
          fillChild(subLayer, 'customStyle', DEFAULT_ROAD_STYLE);
          fillChild(subLayer, 'labelStyle', DEFAULT_LABEL_STYLE);
          return subLayer;
        });
      } else {
        layer.roadSubLayers = [];
      }

      return layer;
    });
  }

  if (Array.isArray(root.signOutputs) && root.signOutputs.every(isObject)) {
    root.signOutputs = root.signOutputs.map((sign) => {
      const upgraded = { ...sign };
      fillMissing(upgraded, signOutputDefaults(newUUID()));
      return upgraded;
    });
  }

  return root;
}

/** Parse a `.nolli` JSON document, fill legacy defaults and validate its model. */
export function loadProject(json: string): ProjectSnapshot {
  return ProjectSnapshotSchema.parse(upgradeProject(JSON.parse(json)));
}

function encodeManualDictionary<Value>(
  dictionary: ReadonlyMap<number, Value>,
): Array<number | Value> | undefined {
  return dictionary.size > 0 ? flattenInt64Dictionary(dictionary) : undefined;
}

function encodeLayer(layer: LayerSnapshot): JsonObject {
  return {
    ...layer,
    roadSubLayers: layer.roadSubLayers.map((subLayer) => ({
      ...subLayer,
      labelOverrides: subLayer.labelOverrides ? [...subLayer.labelOverrides] : undefined,
      lineOverrides: subLayer.lineOverrides ? [...subLayer.lineOverrides] : undefined,
    })),
    labelOffsets: encodeManualDictionary(layer.labelOffsets),
    labelAlongOffsets: encodeManualDictionary(layer.labelAlongOffsets),
    labelPins: encodeManualDictionary(layer.labelPins),
    symbolOffsets: encodeManualDictionary(layer.symbolOffsets),
    originalLineGeometry: encodeManualDictionary(layer.originalLineGeometry),
    originalPolygonGeometry: encodeManualDictionary(layer.originalPolygonGeometry),
    originalPointGeometry: encodeManualDictionary(layer.originalPointGeometry),
  };
}

/**
 * Encode a loaded project using Swift JSONEncoder's wire representations.
 * Object key order is intentionally unspecified, as it is in the macOS app.
 */
export function serializeProject(project: ProjectSnapshot): string {
  return JSON.stringify(
    { ...project, version: CURRENT_PROJECT_VERSION, layers: project.layers.map(encodeLayer) },
    (_key, value: unknown) => (value === null ? undefined : value),
  );
}
