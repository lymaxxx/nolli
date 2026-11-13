import { apply, invert, type Point } from '../geometry/affine';
import type {
  LayerKind,
  LayerSnapshot,
  LineFeature,
  PolygonFeature,
} from '../model/layers';
import type { CodableColor, POIStyle, RoadStyle } from '../model/styles';
import {
  artworkTransform,
  worldPoint,
  type Projection,
} from '../projection/projection';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ScenePath =
  | { kind: 'polyline'; points: number[] }
  | { kind: 'polygon'; rings: number[][] };

export interface SceneCell {
  bounds: Rect;
  paths: ScenePath[];
}

export interface SceneBatch {
  layerId: string;
  subLayerId?: string;
  cells: SceneCell[];
  fill?: string;
  evenOdd?: boolean;
  stroke?: string;
  lineWidth: number;
  cap: RoadStyle['lineCap'];
  join: RoadStyle['lineJoin'];
  /** Position in the native layer order; markers and batches interleave by it. */
  sequence: number;
}

export interface SceneMarker {
  id: number;
  x: number;
  y: number;
}

export interface SceneMarkerBatch {
  layerId: string;
  markers: SceneMarker[];
  shape: POIStyle['shape'];
  size: number;
  fill: string;
  stroke?: string;
  strokeWidth: number;
  sequence: number;
}

export interface Scene {
  origin: Point;
  baseZoom: number;
  batches: SceneBatch[];
  markers: SceneMarkerBatch[];
  featureCount: number;
}

const POLYGON_KINDS: ReadonlySet<LayerKind> = new Set([
  'background',
  'parking',
  'parks',
  'water',
  'buildings',
  'pedestrian_zones',
  'plazas',
]);

const POINT_KINDS: ReadonlySet<LayerKind> = new Set([
  'landmarks',
  'transport',
  'dining',
  'accommodation',
  'healthcare',
  'shopping',
  'education',
]);

export function featureKind(kind: LayerKind): 'line' | 'polygon' | 'point' {
  if (POLYGON_KINDS.has(kind)) return 'polygon';
  if (POINT_KINDS.has(kind)) return 'point';
  return 'line';
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Canvas-ready rgba string. Alpha is multiplied by the style's own opacity. */
export function cssColor(color: CodableColor, opacity = 1): string {
  const r = Math.round(clampUnit(color.r) * 255);
  const g = Math.round(clampUnit(color.g) * 255);
  const b = Math.round(clampUnit(color.b) * 255);
  const a = clampUnit(color.a) * clampUnit(opacity);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function boundsOfPoints(points: readonly number[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let index = 0; index + 1 < points.length; index += 2) {
    const x = points[index]!;
    const y = points[index + 1]!;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function unionBounds(first: Rect, second: Rect): Rect {
  const minX = Math.min(first.x, second.x);
  const minY = Math.min(first.y, second.y);
  const maxX = Math.max(first.x + first.width, second.x + second.width);
  const maxY = Math.max(first.y + first.height, second.y + second.height);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function isEmptyRect(rect: Rect): boolean {
  return !(rect.width > 0) && !(rect.height > 0);
}

function localPoint(
  coordinate: readonly number[],
  baseZoom: number,
  origin: Point,
): Point | null {
  const lon = coordinate[0];
  const lat = coordinate[1];
  if (lon === undefined || lat === undefined) return null;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const world = worldPoint(lat, lon, baseZoom);
  return { x: world.x - origin.x, y: world.y - origin.y };
}

interface PendingCell {
  paths: ScenePath[];
  bounds: Rect;
}

/** Merge features into square cells so drawing issues far fewer calls. */
function groupCells(items: PendingCell[]): SceneCell[] {
  const cellSize = 768;
  const grid = new Map<string, PendingCell>();
  for (const item of items) {
    if (isEmptyRect(item.bounds)) continue;
    const key = `${Math.floor((item.bounds.x + item.bounds.width / 2) / cellSize)}:${Math.floor(
      (item.bounds.y + item.bounds.height / 2) / cellSize,
    )}`;
    const existing = grid.get(key);
    if (existing) {
      existing.paths.push(...item.paths);
      existing.bounds = unionBounds(existing.bounds, item.bounds);
    } else {
      grid.set(key, { paths: [...item.paths], bounds: item.bounds });
    }
  }
  return [...grid.values()];
}

function linePath(
  coords: readonly (readonly number[])[],
  baseZoom: number,
  origin: Point,
): PendingCell | null {
  const points: number[] = [];
  for (const coordinate of coords) {
    const point = localPoint(coordinate, baseZoom, origin);
    if (point) points.push(point.x, point.y);
  }
  if (points.length < 4) return null;
  return {
    paths: [{ kind: 'polyline', points }],
    bounds: boundsOfPoints(points),
  };
}

function polygonPath(
  feature: PolygonFeature,
  baseZoom: number,
  origin: Point,
): PendingCell | null {
  const rings: number[][] = [];
  let bounds: Rect | null = null;
  for (const ring of feature.rings) {
    const points: number[] = [];
    for (const coordinate of ring) {
      const point = localPoint(coordinate, baseZoom, origin);
      if (point) points.push(point.x, point.y);
    }
    if (points.length < 4) continue;
    rings.push(points);
    const ringBounds = boundsOfPoints(points);
    bounds = bounds ? unionBounds(bounds, ringBounds) : ringBounds;
  }
  if (!bounds || rings.length === 0) return null;
  return { paths: [{ kind: 'polygon', rings }], bounds };
}

interface LineGeometry {
  path: PendingCell;
  highway: string | undefined;
}

function lineGeometries(
  features: readonly LineFeature[],
  baseZoom: number,
  origin: Point,
): LineGeometry[] {
  const lines: LineGeometry[] = [];
  for (const feature of features) {
    const path = linePath(feature.coordinates, baseZoom, origin);
    if (path) lines.push({ path, highway: feature.tags['highway'] });
  }
  return lines;
}

/** The top row renders on top; layers are stored top-first. */
function visibleLayers(layers: readonly LayerSnapshot[]): LayerSnapshot[] {
  return layers.filter((layer) => layer.isVisible).reverse();
}

function sceneOrigin(layers: readonly LayerSnapshot[], baseZoom: number): Point {
  for (const layer of layers) {
    const line = layer.lineFeatures[0]?.coordinates[0];
    if (line && line.length >= 2) {
      const point = localPoint(line, baseZoom, { x: 0, y: 0 });
      if (point) return { x: Math.round(point.x), y: Math.round(point.y) };
    }
    const polygon = layer.polygonFeatures[0]?.rings[0]?.[0];
    if (polygon && polygon.length >= 2) {
      const point = localPoint(polygon, baseZoom, { x: 0, y: 0 });
      if (point) return { x: Math.round(point.x), y: Math.round(point.y) };
    }
    const feature = layer.pointFeatures[0]?.coordinate;
    if (feature && feature.length >= 2) {
      const point = localPoint(feature, baseZoom, { x: 0, y: 0 });
      if (point) return { x: Math.round(point.x), y: Math.round(point.y) };
    }
  }
  return { x: 0, y: 0 };
}

function resolvedLineStyle(master: RoadStyle, sub: LayerSnapshot['roadSubLayers'][number]): RoadStyle {
  // A non-nil override set (even empty) means the subtype owns its style.
  if (sub.lineOverrides !== undefined) return sub.customStyle;
  return sub.useCustomStyle ? sub.customStyle : master;
}

function addLineBatch(
  batches: SceneBatch[],
  layerId: string,
  cells: SceneCell[],
  style: RoadStyle,
  sequence: number,
  subLayerId?: string,
): void {
  if (cells.length === 0) return;
  if (style.casingEnabled && style.casingWidth > 0) {
    batches.push({
      layerId,
      subLayerId,
      cells,
      stroke: cssColor(style.casingColor),
      lineWidth: style.casingWidth,
      cap: style.lineCap,
      join: style.lineJoin,
      sequence,
    });
  }
  batches.push({
    layerId,
    subLayerId,
    cells,
    stroke: cssColor(style.color, style.opacity),
    lineWidth: style.width,
    cap: style.lineCap,
    join: style.lineJoin,
    sequence,
  });
}

function compileLines(
  layer: LayerSnapshot,
  baseZoom: number,
  origin: Point,
  batches: SceneBatch[],
  nextSequence: () => number,
): number {
  const lines = lineGeometries(layer.lineFeatures, baseZoom, origin);
  if (layer.kind === 'roads') {
    // Sublayer 0 renders on top, so paint the list in reverse.
    for (const sub of [...layer.roadSubLayers].reverse()) {
      if (!sub.isVisible) continue;
      const types = new Set(sub.roadTypes);
      const cells = groupCells(
        lines
          .filter((line) => line.highway !== undefined && types.has(line.highway))
          .map((line) => line.path),
      );
      addLineBatch(
        batches,
        layer.id,
        cells,
        resolvedLineStyle(layer.roadStyle, sub),
        nextSequence(),
        sub.id,
      );
    }
  } else {
    addLineBatch(
      batches,
      layer.id,
      groupCells(lines.map((line) => line.path)),
      layer.roadStyle,
      nextSequence(),
    );
  }
  return layer.lineFeatures.length;
}

function compilePolygons(
  layer: LayerSnapshot,
  baseZoom: number,
  origin: Point,
  batches: SceneBatch[],
  nextSequence: () => number,
): number {
  const single: PendingCell[] = [];
  const multi: PendingCell[] = [];
  for (const feature of layer.polygonFeatures) {
    const cell = polygonPath(feature, baseZoom, origin);
    if (!cell) continue;
    (feature.rings.length > 1 ? multi : single).push(cell);
  }

  const style = layer.areaStyle;
  const fill = cssColor(style.fillColor, style.fillOpacity);
  const stroke =
    style.strokeEnabled && style.strokeWidth > 0 ? cssColor(style.strokeColor) : undefined;

  const singleCells = groupCells(single);
  if (singleCells.length > 0) {
    batches.push({
      layerId: layer.id,
      cells: singleCells,
      fill,
      stroke,
      lineWidth: style.strokeWidth,
      cap: 'round',
      join: 'round',
      sequence: nextSequence(),
    });
  }
  const multiCells = groupCells(multi);
  if (multiCells.length > 0) {
    batches.push({
      layerId: layer.id,
      cells: multiCells,
      fill,
      evenOdd: true,
      stroke,
      lineWidth: style.strokeWidth,
      cap: 'round',
      join: 'round',
      sequence: nextSequence(),
    });
  }

  // Unclosed ways in area layers (rivers, canals) draw as lines.
  const stray = lineGeometries(layer.lineFeatures, baseZoom, origin);
  const strayCells = groupCells(stray.map((line) => line.path));
  if (strayCells.length > 0) {
    batches.push({
      layerId: layer.id,
      cells: strayCells,
      stroke: fill,
      lineWidth: Math.max(style.strokeWidth, 2),
      cap: 'round',
      join: 'round',
      sequence: nextSequence(),
    });
  }

  return layer.polygonFeatures.length + stray.length;
}

function compilePoints(
  layer: LayerSnapshot,
  baseZoom: number,
  origin: Point,
  markers: SceneMarkerBatch[],
  nextSequence: () => number,
): number {
  const items: SceneMarker[] = [];
  for (const feature of layer.pointFeatures) {
    const point = localPoint(feature.coordinate, baseZoom, origin);
    if (point) items.push({ id: feature.id, x: point.x, y: point.y });
  }
  if (items.length === 0) return 0;
  const style = layer.poiStyle;
  markers.push({
    layerId: layer.id,
    markers: items,
    shape: style.shape,
    size: style.size,
    fill: cssColor(style.fillColor),
    stroke: style.strokeWidth > 0 ? cssColor(style.strokeColor) : undefined,
    strokeWidth: style.strokeWidth,
    sequence: nextSequence(),
  });
  return layer.pointFeatures.length;
}

/**
 * Compile a project's layers into artwork-space geometry. This is the pure
 * half of the renderer: no canvas, no tiles, no camera. Every cell is already
 * in base-zoom pixels relative to `origin`, so any view can draw it through
 * one affine transform.
 */
export function compileScene(
  layers: readonly LayerSnapshot[],
  baseZoom: number,
): Scene {
  const origin = sceneOrigin(layers, baseZoom);
  const batches: SceneBatch[] = [];
  const markers: SceneMarkerBatch[] = [];
  let featureCount = 0;
  let sequence = 0;
  const nextSequence = () => {
    const value = sequence;
    sequence += 1;
    return value;
  };

  for (const layer of visibleLayers(layers)) {
    switch (featureKind(layer.kind)) {
      case 'line':
        featureCount += compileLines(layer, baseZoom, origin, batches, nextSequence);
        break;
      case 'polygon':
        featureCount += compilePolygons(layer, baseZoom, origin, batches, nextSequence);
        break;
      case 'point':
        featureCount += compilePoints(layer, baseZoom, origin, markers, nextSequence);
        break;
    }
  }

  return { origin, baseZoom, batches, markers, featureCount };
}

/**
 * The area of artwork space covered by a screen rectangle. `cellIntersects`
 * uses it to skip off-screen cells.
 */
export function sceneCullRect(
  scene: Scene,
  projection: Projection,
  screen: Rect = { x: 0, y: 0, width: projection.viewport.width, height: projection.viewport.height },
): Rect {
  const inverse = invert(artworkTransform(projection, scene.baseZoom, scene.origin));
  const corners = [
    { x: screen.x, y: screen.y },
    { x: screen.x + screen.width, y: screen.y },
    { x: screen.x, y: screen.y + screen.height },
    { x: screen.x + screen.width, y: screen.y + screen.height },
  ].map((point) => apply(inverse, point));
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

export function cellIntersects(cell: SceneCell, cull: Rect, padding = 0): boolean {
  const bounds = cell.bounds;
  return !(
    bounds.x + bounds.width + padding < cull.x ||
    cull.x + cull.width + padding < bounds.x ||
    bounds.y + bounds.height + padding < cull.y ||
    cull.y + cull.height + padding < bounds.y
  );
}
