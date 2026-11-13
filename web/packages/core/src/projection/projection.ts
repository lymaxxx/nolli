import {
  invert,
  multiply,
  rotation,
  scaling,
  translation,
  type Affine,
  type Point,
} from '../geometry/affine';

/** Edge length of one tile, and of the world, at zoom 0. */
export const TILE_SIZE = 256;

/** Web Mercator goes to infinity at the poles; both apps stop just short. */
export const MAX_MERCATOR_LAT = 89.9;

export interface Viewport {
  width: number;
  height: number;
}

/** What the camera is looking at, without any knowledge of a viewport. */
export interface CameraPose {
  centerLat: number;
  centerLon: number;
  zoom: number;
  /** Heading-up rotation in degrees: the compass heading at the top of the view. */
  rotation: number;
}

export interface Projection extends CameraPose {
  viewport: Viewport;
}

export function projectionOf(camera: CameraPose, viewport: Viewport): Projection {
  return {
    centerLat: camera.centerLat,
    centerLon: camera.centerLon,
    zoom: camera.zoom,
    rotation: camera.rotation,
    viewport,
  };
}

/** Absolute Web Mercator world pixel for a geographic point at any zoom. */
export function worldPoint(lat: number, lon: number, zoom: number): Point {
  const size = TILE_SIZE * 2 ** zoom;
  const clampedLat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
  const phi = (clampedLat * Math.PI) / 180;
  const sinPhi = Math.sin(phi);
  return {
    x: ((lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sinPhi) / (1 - sinPhi)) / (4 * Math.PI)) * size,
  };
}

/** Inverse of `worldPoint`. */
export function latLonAt(point: Point, zoom: number): { lat: number; lon: number } {
  const size = TILE_SIZE * 2 ** zoom;
  return {
    lat:
      ((2 * Math.atan(Math.exp((0.5 - point.y / size) * 2 * Math.PI)) - Math.PI / 2) * 180) /
      Math.PI,
    lon: (point.x / size) * 360 - 180,
  };
}

/** Absolute world point under a screen point, at an arbitrary world zoom. */
export function fromScreenWorld(
  projection: Projection,
  x: number,
  y: number,
  worldZoom: number,
): Point {
  const { viewport, rotation: degrees } = projection;
  let dx = x - viewport.width / 2;
  let dy = y - viewport.height / 2;

  if (degrees !== 0) {
    const radians = (-degrees * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    [dx, dy] = [dx * cos + dy * sin, -dx * sin + dy * cos];
  }

  const factor = 2 ** (projection.zoom - worldZoom);
  const center = worldPoint(projection.centerLat, projection.centerLon, projection.zoom);
  return { x: (center.x + dx) / factor, y: (center.y + dy) / factor };
}

/** Screen point for an absolute world pixel at an arbitrary world zoom. */
export function toScreenWorld(
  projection: Projection,
  world: Point,
  worldZoom: number,
): Point {
  const factor = 2 ** (projection.zoom - worldZoom);
  const center = worldPoint(projection.centerLat, projection.centerLon, projection.zoom);
  let dx = world.x * factor - center.x;
  let dy = world.y * factor - center.y;

  if (projection.rotation !== 0) {
    const radians = (projection.rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    [dx, dy] = [dx * cos + dy * sin, -dx * sin + dy * cos];
  }

  return {
    x: projection.viewport.width / 2 + dx,
    y: projection.viewport.height / 2 + dy,
  };
}

export function toScreen(projection: Projection, lat: number, lon: number): Point {
  return toScreenWorld(
    projection,
    worldPoint(lat, lon, projection.zoom),
    projection.zoom,
  );
}

export function fromScreen(
  projection: Projection,
  x: number,
  y: number,
): { lat: number; lon: number } {
  return latLonAt(fromScreenWorld(projection, x, y, projection.zoom), projection.zoom);
}

/**
 * Absolute world pixels at `worldZoom` to screen CSS pixels. This is the one
 * similarity every layer is drawn through: tiles use it at their own tile zoom
 * and vectors use it at the project's artwork zoom.
 */
export function screenTransform(projection: Projection, worldZoom: number): Affine {
  const center = worldPoint(projection.centerLat, projection.centerLon, worldZoom);
  const factor = 2 ** (projection.zoom - worldZoom);
  const radians = (projection.rotation * Math.PI) / 180;
  return multiply(
    translation(projection.viewport.width / 2, projection.viewport.height / 2),
    multiply(
      rotation(-radians),
      multiply(scaling(factor), translation(-center.x, -center.y)),
    ),
  );
}

/**
 * Scene-local artwork space (base-zoom world pixels relative to `origin`) to
 * screen CSS pixels. Zoom and rotation are pure CTM operations, so vectors
 * never need to be laid out again and cannot drift from tiles.
 */
export function artworkTransform(
  projection: Projection,
  baseZoom: number,
  origin: Point,
): Affine {
  return multiply(
    screenTransform(projection, baseZoom),
    translation(origin.x, origin.y),
  );
}

/**
 * The screen-space transform that moves a finished frame drawn with `from` so
 * it matches `to`. Gestures apply this to the canvas with CSS, then the worker
 * replaces it with a real frame.
 */
export function relativeScreenTransform(
  from: Projection,
  to: Projection,
  worldZoom = 0,
): Affine {
  return multiply(
    screenTransform(to, worldZoom),
    invert(screenTransform(from, worldZoom)),
  );
}

/** A screen drag converted to an artwork-space drag at `worldZoom`. */
export function worldDeltaFromScreen(
  projection: Projection,
  deltaX: number,
  deltaY: number,
  worldZoom: number,
): Point {
  let dx = deltaX;
  let dy = deltaY;
  if (projection.rotation !== 0) {
    const radians = (-projection.rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    [dx, dy] = [dx * cos + dy * sin, -dx * sin + dy * cos];
  }
  const factor = 2 ** (projection.zoom - worldZoom);
  return { x: dx / factor, y: dy / factor };
}
