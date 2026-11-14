import { resolvedText, type MapLabelLayout } from '../layout/labels';
import { featureKind } from '../render/scene';
import {
  DEFAULT_AREA_STYLE,
  DEFAULT_LABEL_STYLE,
  DEFAULT_POI_STYLE,
  DEFAULT_ROAD_STYLE,
  DEFAULT_SYMBOL_STYLE,
  type CodableColor,
  type LabelStyle,
  type RoadStyle,
  type TextStyle,
} from './styles';
import type { LayerKind, LayerSnapshot, RoadSubLayer } from './layers';
import type { ProjectSnapshot } from './project';

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
    for (const key of keys) {
      if (!valuesEqual(aObj[key], bObj[key])) return false;
    }
    return true;
  }
  return false;
}

/**
 * Keys whose values differ between `a` and `b`, ported from
 * `Inheritance.changedKeys` and `LabelStyle.changedKeys` in `Styles.swift`.
 */
export function changedStyleKeys<T extends object>(a: T, b: T): Set<string> {
  const aRec = a as Record<string, unknown>;
  const bRec = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(aRec), ...Object.keys(bRec)]);
  const changed = new Set<string>();
  for (const key of keys) {
    if (!valuesEqual(aRec[key], bRec[key])) changed.add(key);
  }
  return changed;
}

/**
 * Returns a copy of `child` with every field NOT in `pinned` overwritten by
 * `master`, ported from `Inheritance.merge` and `LabelStyle.inheriting` in `Styles.swift`.
 */
export function mergeInheritedStyle<T extends object>(
  child: T,
  master: T,
  pinned: ReadonlySet<string>,
): T {
  const result = { ...(child as Record<string, unknown>) };
  const masterRec = master as Record<string, unknown>;
  for (const [key, value] of Object.entries(masterRec)) {
    if (!pinned.has(key)) {
      result[key] = value;
    }
  }
  if (!pinned.has('textStyleId') && masterRec['textStyleId'] === undefined) {
    delete result['textStyleId'];
  }
  return result as T;
}

/** Propagates `layer.roadStyle` into every road subtype's `customStyle` for non-pinned fields. */
export function syncSubLineStyles(layer: LayerSnapshot): LayerSnapshot {
  if (layer.kind !== 'roads') return layer;
  return {
    ...layer,
    roadSubLayers: layer.roadSubLayers.map((sub) => {
      const pinned = sub.lineOverrides ?? new Set<string>();
      return {
        ...sub,
        customStyle: mergeInheritedStyle(sub.customStyle, layer.roadStyle, pinned),
      };
    }),
  };
}

/** Propagates `layer.labelStyle` into every road subtype's `labelStyle` for non-pinned fields. */
export function syncSubLabelStyles(layer: LayerSnapshot): LayerSnapshot {
  if (layer.kind !== 'roads') return layer;
  return {
    ...layer,
    roadSubLayers: layer.roadSubLayers.map((sub) => {
      const pinned = sub.labelOverrides ?? new Set<string>();
      const base = sub.labelStyle ?? layer.labelStyle;
      return {
        ...sub,
        labelStyle: mergeInheritedStyle(base, layer.labelStyle, pinned),
      };
    }),
  };
}

/**
 * Ensures every road subtype has materialized line and label styles and override
 * sets, ported from `MapLayer.materializeSubLabelStyles(migrateOverrides:)` in `MapLayer.swift`.
 */
export function materializeRoadSubLayers(
  layer: LayerSnapshot,
  migrateOverrides = true,
): LayerSnapshot {
  if (layer.kind !== 'roads') return layer;
  return {
    ...layer,
    roadSubLayers: layer.roadSubLayers.map((sub) => {
      let customStyle = sub.customStyle;
      let lineOverrides = sub.lineOverrides ? new Set(sub.lineOverrides) : undefined;
      if (lineOverrides === undefined) {
        if (sub.useCustomStyle) {
          lineOverrides = changedStyleKeys(layer.roadStyle, sub.customStyle);
        } else {
          customStyle = { ...layer.roadStyle };
          lineOverrides = new Set<string>();
          if (sub.defaultWidth != null) {
            customStyle.width = sub.defaultWidth;
            lineOverrides.add('width');
          }
        }
      }

      let labelStyle = sub.labelStyle;
      let labelOverrides = sub.labelOverrides ? new Set(sub.labelOverrides) : undefined;
      if (labelOverrides === undefined) {
        if (migrateOverrides && sub.useCustomLabelStyle && sub.labelStyle) {
          labelOverrides = changedStyleKeys(layer.labelStyle, sub.labelStyle);
          labelStyle = { ...sub.labelStyle };
        } else {
          labelStyle = { ...layer.labelStyle };
          labelOverrides = new Set<string>();
        }
      }

      return {
        ...sub,
        customStyle,
        lineOverrides,
        labelStyle,
        labelOverrides,
      };
    }),
  };
}

/** Materializes road subtype styles across all layers of a project, as `ProjectManager.apply` does on load. */
export function materializeProject(project: ProjectSnapshot): ProjectSnapshot {
  return {
    ...project,
    layers: project.layers.map((layer) => materializeRoadSubLayers(layer, true)),
  };
}

/**
 * Updates either the master road line style (`subId === null`) or one road
 * subtype's line style (`subId`), pinning the edited keys on the subtype or
 * propagating master changes to unpinned subtypes.
 */
export function updateRoadLineStyle(
  layer: LayerSnapshot,
  subId: string | null,
  patch: Partial<RoadStyle>,
): LayerSnapshot {
  const materialized = materializeRoadSubLayers(layer, true);
  if (subId === null) {
    return syncSubLineStyles({
      ...materialized,
      roadStyle: { ...materialized.roadStyle, ...patch },
    });
  }
  const patchKeys = Object.keys(patch);
  return {
    ...materialized,
    roadSubLayers: materialized.roadSubLayers.map((sub) => {
      if (sub.id !== subId) return sub;
      const lineOverrides = new Set(sub.lineOverrides ?? []);
      for (const key of patchKeys) lineOverrides.add(key);
      return {
        ...sub,
        customStyle: { ...sub.customStyle, ...patch },
        lineOverrides,
      };
    }),
  };
}

/** Resets one or all line overrides on a road subtype back to the master `roadStyle`. */
export function resetRoadLineOverrides(
  layer: LayerSnapshot,
  subId: string,
  keys?: readonly string[],
): LayerSnapshot {
  const materialized = materializeRoadSubLayers(layer, true);
  const updated: LayerSnapshot = {
    ...materialized,
    roadSubLayers: materialized.roadSubLayers.map((sub) => {
      if (sub.id !== subId) return sub;
      const lineOverrides = new Set(sub.lineOverrides ?? []);
      if (!keys) {
        lineOverrides.clear();
      } else {
        for (const key of keys) lineOverrides.delete(key);
      }
      return { ...sub, lineOverrides };
    }),
  };
  return syncSubLineStyles(updated);
}

/**
 * Updates either the master label style (`subId === null`) or one road
 * subtype's label style (`subId`), pinning edited keys on the subtype or
 * propagating master changes to unpinned subtypes.
 */
export function updateRoadLabelStyle(
  layer: LayerSnapshot,
  subId: string | null,
  patch: Partial<LabelStyle>,
): LayerSnapshot {
  const materialized = materializeRoadSubLayers(layer, true);
  if (subId === null || materialized.kind !== 'roads') {
    const nextMaster = { ...materialized.labelStyle, ...patch };
    return syncSubLabelStyles({
      ...materialized,
      labelStyle: nextMaster,
    });
  }
  const patchKeys = Object.keys(patch);
  return {
    ...materialized,
    roadSubLayers: materialized.roadSubLayers.map((sub) => {
      if (sub.id !== subId) return sub;
      const labelOverrides = new Set(sub.labelOverrides ?? []);
      for (const key of patchKeys) labelOverrides.add(key);
      const base = sub.labelStyle ?? materialized.labelStyle;
      return {
        ...sub,
        labelStyle: { ...base, ...patch },
        labelOverrides,
      };
    }),
  };
}

/** Resets one or all label overrides on a road subtype back to the master `labelStyle`. */
export function resetRoadLabelOverrides(
  layer: LayerSnapshot,
  subId: string,
  keys?: readonly string[],
): LayerSnapshot {
  const materialized = materializeRoadSubLayers(layer, true);
  const updated: LayerSnapshot = {
    ...materialized,
    roadSubLayers: materialized.roadSubLayers.map((sub) => {
      if (sub.id !== subId) return sub;
      const labelOverrides = new Set(sub.labelOverrides ?? []);
      if (!keys) {
        labelOverrides.clear();
      } else {
        for (const key of keys) labelOverrides.delete(key);
      }
      return { ...sub, labelOverrides };
    }),
  };
  return syncSubLabelStyles(updated);
}

// MARK: - Layer metadata & creation (`MapLayer.swift`)

export interface LayerKindMeta {
  kind: LayerKind;
  displayName: string;
  defaultColor: CodableColor;
}

export const LAYER_KIND_META: Readonly<Record<LayerKind, LayerKindMeta>> = {
  roads: { kind: 'roads', displayName: 'Roads', defaultColor: { r: 0.2, g: 0.2, b: 0.2, a: 1 } },
  parks: {
    kind: 'parks',
    displayName: 'Parks & Green Space',
    defaultColor: { r: 0.6, g: 0.8, b: 0.6, a: 1 },
  },
  water: { kind: 'water', displayName: 'Water', defaultColor: { r: 0.5, g: 0.7, b: 0.9, a: 1 } },
  buildings: {
    kind: 'buildings',
    displayName: 'Buildings',
    defaultColor: { r: 0.85, g: 0.82, b: 0.78, a: 1 },
  },
  pedestrian_zones: {
    kind: 'pedestrian_zones',
    displayName: 'Pedestrian Zones',
    defaultColor: { r: 0.95, g: 0.9, b: 0.8, a: 1 },
  },
  plazas: {
    kind: 'plazas',
    displayName: 'Plazas & Squares',
    defaultColor: { r: 0.9, g: 0.87, b: 0.83, a: 1 },
  },
  landmarks: {
    kind: 'landmarks',
    displayName: 'Landmarks',
    defaultColor: { r: 0.9, g: 0.22, b: 0.21, a: 1 },
  },
  transport: {
    kind: 'transport',
    displayName: 'Transport',
    defaultColor: { r: 0.1, g: 0.5, b: 0.9, a: 1 },
  },
  dining: {
    kind: 'dining',
    displayName: 'Dining',
    defaultColor: { r: 0.95, g: 0.45, b: 0.1, a: 1 },
  },
  accommodation: {
    kind: 'accommodation',
    displayName: 'Accommodation',
    defaultColor: { r: 0.5, g: 0.2, b: 0.8, a: 1 },
  },
  healthcare: {
    kind: 'healthcare',
    displayName: 'Healthcare',
    defaultColor: { r: 0.9, g: 0.1, b: 0.3, a: 1 },
  },
  parking: {
    kind: 'parking',
    displayName: 'Parking',
    defaultColor: { r: 0.4, g: 0.6, b: 0.8, a: 1 },
  },
  shopping: {
    kind: 'shopping',
    displayName: 'Shopping',
    defaultColor: { r: 0.1, g: 0.6, b: 0.6, a: 1 },
  },
  education: {
    kind: 'education',
    displayName: 'Education',
    defaultColor: { r: 0.2, g: 0.5, b: 0.3, a: 1 },
  },
  background: {
    kind: 'background',
    displayName: 'Background',
    defaultColor: { r: 0.97, g: 0.95, b: 0.9, a: 1 },
  },
};

const DEFAULT_ROAD_SUBLAYER_SPECS: readonly {
  name: string;
  roadTypes: string[];
  width: number;
}[] = [
  { name: 'Motorway', roadTypes: ['motorway', 'motorway_link'], width: 3.5 },
  { name: 'Trunk', roadTypes: ['trunk', 'trunk_link'], width: 3.2 },
  { name: 'Primary', roadTypes: ['primary', 'primary_link'], width: 3 },
  { name: 'Secondary', roadTypes: ['secondary', 'secondary_link'], width: 2.6 },
  { name: 'Tertiary', roadTypes: ['tertiary', 'tertiary_link'], width: 2.2 },
  {
    name: 'Residential',
    roadTypes: ['residential', 'unclassified', 'living_street', 'road'],
    width: 1.8,
  },
  { name: 'Pedestrian', roadTypes: ['pedestrian'], width: 1.4 },
  { name: 'Service', roadTypes: ['service', 'busway'], width: 1 },
  {
    name: 'Paths',
    roadTypes: ['footway', 'path', 'steps', 'corridor', 'bridleway', 'track'],
    width: 0.6,
  },
  { name: 'Cycleways', roadTypes: ['cycleway'], width: 0.6 },
];

function randomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Creates a new layer with the macOS app's defaults (`MapLayer.init(kind:name:id:)`). */
export function createLayer(
  kind: LayerKind,
  name?: string,
  id = randomUUID(),
): LayerSnapshot {
  const meta = LAYER_KIND_META[kind];
  const color = { ...meta.defaultColor };
  const fKind = featureKind(kind);

  const labelStyle: LabelStyle = {
    ...DEFAULT_LABEL_STYLE,
    enabled: kind !== 'buildings' && kind !== 'background',
    placement: fKind === 'point' ? 'top' : DEFAULT_LABEL_STYLE.placement,
  };

  const roadSubLayers: RoadSubLayer[] =
    kind === 'roads'
      ? DEFAULT_ROAD_SUBLAYER_SPECS.map((spec) => ({
          id: randomUUID(),
          name: spec.name,
          roadTypes: [...spec.roadTypes],
          isVisible: true,
          useCustomStyle: false,
          customStyle: { ...DEFAULT_ROAD_STYLE },
          defaultWidth: spec.width,
          useCustomLabelStyle: false,
        }))
      : [];

  const layer: LayerSnapshot = {
    id,
    name: name ?? meta.displayName,
    kind,
    isVisible: true,
    roadStyle: { ...DEFAULT_ROAD_STYLE, color },
    areaStyle: { ...DEFAULT_AREA_STYLE, fillColor: color },
    poiStyle: { ...DEFAULT_POI_STYLE, fillColor: color },
    labelStyle,
    symbolStyle: { ...DEFAULT_SYMBOL_STYLE },
    roadSubLayers,
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
  };

  return materializeRoadSubLayers(layer, false);
}

/** Whether the layer carries any manual edit-mode change (`MapLayer.hasManualEdits`). */
export function hasManualEdits(layer: LayerSnapshot): boolean {
  return (
    layer.labelOffsets.size > 0 ||
    layer.labelAlongOffsets.size > 0 ||
    layer.labelPins.size > 0 ||
    layer.symbolOffsets.size > 0 ||
    layer.originalLineGeometry.size > 0 ||
    layer.originalPolygonGeometry.size > 0 ||
    layer.originalPointGeometry.size > 0
  );
}

/** Restores fetched geometry and clears all manual label/icon offsets (`MapLayer.resetManualEdits`). */
export function resetManualEdits(layer: LayerSnapshot): LayerSnapshot {
  return {
    ...layer,
    lineFeatures: layer.lineFeatures.map((feature) => {
      const orig = layer.originalLineGeometry.get(feature.id);
      return orig ? { ...feature, coordinates: orig } : feature;
    }),
    polygonFeatures: layer.polygonFeatures.map((feature) => {
      const orig = layer.originalPolygonGeometry.get(feature.id);
      return orig ? { ...feature, rings: orig } : feature;
    }),
    pointFeatures: layer.pointFeatures.map((feature) => {
      const orig = layer.originalPointGeometry.get(feature.id);
      return orig ? { ...feature, coordinate: orig } : feature;
    }),
    labelOffsets: new Map(),
    labelAlongOffsets: new Map(),
    labelPins: new Map(),
    symbolOffsets: new Map(),
    originalLineGeometry: new Map(),
    originalPolygonGeometry: new Map(),
    originalPointGeometry: new Map(),
  };
}

/** Applies a reusable `TextStyle` preset to a `LabelStyle` (`TextStyle.apply(to:)`). */
export function applyTextStyleToLabel(style: LabelStyle, preset: TextStyle): LabelStyle {
  return {
    ...style,
    fontName: preset.fontName,
    fontWeight: preset.fontWeight,
    fontSize: preset.fontSize,
    opacity: preset.opacity,
    color: { ...preset.color },
    haloColor: { ...preset.haloColor },
    haloWidth: preset.haloWidth,
    typeCase: preset.typeCase,
    tracking: preset.tracking,
    wordSpacing: preset.wordSpacing,
    textStyleId: preset.id,
  };
}

/** Captures a `TextStyle` preset from a `LabelStyle` (`TextStyle.capture(from:)`). */
export function captureTextStyleFromLabel(
  name: string,
  style: LabelStyle,
  id = randomUUID(),
): TextStyle {
  return {
    id,
    name,
    fontName: style.fontName,
    fontWeight: style.fontWeight,
    fontSize: style.fontSize,
    opacity: style.opacity,
    color: { ...style.color },
    haloColor: { ...style.haloColor },
    haloWidth: style.haloWidth,
    typeCase: style.typeCase,
    tracking: style.tracking,
    wordSpacing: style.wordSpacing,
  };
}

export interface LayerLabelFit {
  featureCount: number;
  totalNames: number;
  placedNames: number;
}

/**
 * Counts how many distinct feature names exist on `layer` and how many were
 * placed in `layout`, matching `LabelInspector.placementSummary` in `LabelInspector.swift`.
 */
export function layerLabelFit(
  layer: LayerSnapshot,
  layout: MapLabelLayout,
): LayerLabelFit {
  const featureCount =
    layer.lineFeatures.length + layer.polygonFeatures.length + layer.pointFeatures.length;
  const names = new Set<string>();
  const ls = layer.labelStyle;
  for (const f of layer.lineFeatures) {
    const t = resolvedText(f.tags, ls);
    if (t !== undefined) names.add(t);
  }
  for (const f of layer.polygonFeatures) {
    const t = resolvedText(f.tags, ls);
    if (t !== undefined) names.add(t);
  }
  for (const f of layer.pointFeatures) {
    const t = resolvedText(f.tags, ls);
    if (t !== undefined) names.add(t);
  }
  const shown = new Set<string>();
  for (const l of layout.lineLabels) {
    if (l.layerId === layer.id) shown.add(l.text);
  }
  for (const p of layout.pointLabels) {
    if (p.layerId === layer.id) shown.add(p.text);
  }
  return {
    featureCount,
    totalNames: names.size,
    placedNames: shown.size,
  };
}
