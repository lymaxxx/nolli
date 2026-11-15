import type { FetchResult } from '../data/overpass';
import { createLayer, resetManualEdits } from '../model/inheritance';
import type { LayerKind, LayerSnapshot } from '../model/layers';
import { DEFAULT_PROJECT_FIELDS, type BoundingBox, type ProjectSnapshot } from '../model/project';

/** The layers the Area phase offers to download, top row first. */
export const FETCH_KINDS: readonly LayerKind[] = [
  'transport',
  'pedestrian_zones',
  'parks',
  'water',
  'buildings',
  'roads',
];

/**
 * Where a layer kind sits in a new project's layer list (top first). Things
 * drawn as points go on top, then areas, then roads, with the background last.
 */
const STACK_ORDER: readonly LayerKind[] = [
  'transport',
  'pedestrian_zones',
  'parks',
  'water',
  'buildings',
  'roads',
  'background',
];

/** Position of a kind in the usual order; kinds that are not in it go on top. */
function stackRank(kind: LayerKind): number {
  return Math.max(STACK_ORDER.indexOf(kind), -1);
}

export interface InitialView {
  lat: number;
  lon: number;
  zoom: number;
}

/** A project with no layers and no area yet, looking at `view`. */
export function createEmptyProject(view: InitialView = { lat: 51.505, lon: -0.09, zoom: 14 }): ProjectSnapshot {
  return {
    ...DEFAULT_PROJECT_FIELDS,
    settings: { ...DEFAULT_PROJECT_FIELDS.settings },
    layers: [],
    iconLibrary: [],
    textStyles: [],
    colorSwatches: [],
    colorSchemes: [],
    artboardBackgroundEnabled: false,
    signOutputs: [],
    cameraLat: view.lat,
    cameraLon: view.lon,
    cameraZoom: view.zoom,
    baseZoom: Math.round(view.zoom),
  };
}

/**
 * Sets the area to download. A project with no layers yet is designed at the
 * scale it is being looked at, so its base zoom follows the view (as in the
 * macOS app); later changes to the area leave it alone.
 */
export function setProjectArea(project: ProjectSnapshot, area: BoundingBox, viewZoom: number): ProjectSnapshot {
  return {
    ...project,
    boundingBox: { ...area },
    baseZoom: project.layers.length === 0 ? Math.round(viewZoom) : project.baseZoom,
  };
}

/** The background layer's one feature: a rectangle over the whole area. */
function backgroundFeatures(area: BoundingBox) {
  const { minLon, minLat, maxLon, maxLat } = area;
  const ring: [number, number][] = [
    [minLon, minLat],
    [maxLon, minLat],
    [maxLon, maxLat],
    [minLon, maxLat],
    [minLon, minLat],
  ];
  return { polygons: [{ id: 0, tags: {}, rings: [ring] }] };
}

/**
 * Puts downloaded data into the project's layer of `kind`, adding the layer in
 * its usual place if there is none. Fresh data replaces what the layer held,
 * and with it any hand edits, which refer to the old features.
 */
export function applyFetchedLayer(
  project: ProjectSnapshot,
  kind: LayerKind,
  data: FetchResult | null,
  area: BoundingBox,
): ProjectSnapshot {
  const features =
    kind === 'background'
      ? { lines: [], points: [], ...backgroundFeatures(area) }
      : (data ?? { lines: [], polygons: [], points: [] });

  const fill = (layer: LayerSnapshot): LayerSnapshot => ({
    ...resetManualEdits(layer),
    lineFeatures: features.lines,
    polygonFeatures: features.polygons,
    pointFeatures: features.points,
  });

  const existing = project.layers.findIndex((layer) => layer.kind === kind);
  if (existing >= 0) {
    return { ...project, layers: project.layers.map((layer, i) => (i === existing ? fill(layer) : layer)) };
  }

  const created = fill(createLayer(kind));
  const rank = stackRank(kind);
  const at = project.layers.findIndex((layer) => stackRank(layer.kind) > rank);
  const layers = [...project.layers];
  layers.splice(at < 0 ? layers.length : at, 0, created);
  return { ...project, layers };
}
