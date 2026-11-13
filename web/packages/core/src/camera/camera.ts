import type { BoundingBox, ProjectSnapshot } from '../model/project';
import type { Point } from '../geometry/affine';
import {
  fromScreen,
  fromScreenWorld,
  latLonAt,
  projectionOf,
  worldPoint,
  type CameraPose,
  type Projection,
  type Viewport,
} from '../projection/projection';

export const MIN_ZOOM = 2;
export const MAX_ZOOM = 22;
export const MIN_LAT = -85;
export const MAX_LAT = 85;

export const DEFAULT_CAMERA: CameraPose = {
  centerLat: 51.505,
  centerLon: -0.09,
  zoom: 14,
  rotation: 0,
};

export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

export function clampLatitude(lat: number): number {
  return Math.max(MIN_LAT, Math.min(MAX_LAT, lat));
}

/** Keep rotation in a half-open −180…+180 range, like `MapCamera.normalized`. */
export function normalizedRotation(degrees: number): number {
  let value = degrees % 360;
  if (value > 180) value -= 360;
  if (value <= -180) value += 360;
  return value;
}

export function clampCamera(camera: CameraPose): CameraPose {
  return {
    centerLat: clampLatitude(camera.centerLat),
    centerLon: camera.centerLon,
    zoom: clampZoom(camera.zoom),
    rotation: normalizedRotation(camera.rotation),
  };
}

function projection(camera: CameraPose, viewport: Viewport): Projection {
  return projectionOf(camera, viewport);
}

/**
 * Changes zoom and/or rotation while keeping the world point under `anchor`
 * fixed. The centre is corrected in zoom-0 world space, so repeated gestures
 * do not accumulate latitude error.
 */
function withAnchoredView(
  camera: CameraPose,
  viewport: Viewport,
  anchor: Point,
  next: { zoom: number; rotation: number },
): CameraPose {
  const before = fromScreenWorld(projection(camera, viewport), anchor.x, anchor.y, 0);
  const after = fromScreenWorld(
    projection({ ...camera, ...next }, viewport),
    anchor.x,
    anchor.y,
    0,
  );
  const center = worldPoint(camera.centerLat, camera.centerLon, 0);
  const shifted = latLonAt(
    {
      x: center.x + before.x - after.x,
      y: center.y + before.y - after.y,
    },
    0,
  );
  return clampCamera({
    ...camera,
    centerLat: shifted.lat,
    centerLon: shifted.lon,
    zoom: next.zoom,
    rotation: next.rotation,
  });
}

export function zoomAround(
  camera: CameraPose,
  targetZoom: number,
  anchor: Point,
  viewport: Viewport,
): CameraPose {
  return withAnchoredView(camera, viewport, anchor, {
    zoom: clampZoom(targetZoom),
    rotation: camera.rotation,
  });
}

/** Moves the map's content by a screen-space delta, so it follows the pointer. */
export function panBy(
  camera: CameraPose,
  deltaX: number,
  deltaY: number,
  viewport: Viewport,
): CameraPose {
  const center = fromScreen(
    projection(camera, viewport),
    viewport.width / 2 - deltaX,
    viewport.height / 2 - deltaY,
  );
  return clampCamera({ ...camera, centerLat: center.lat, centerLon: center.lon });
}

export function rotateAround(
  camera: CameraPose,
  degrees: number,
  anchor: Point,
  viewport: Viewport,
): CameraPose {
  return withAnchoredView(camera, viewport, anchor, {
    zoom: camera.zoom,
    rotation: normalizedRotation(camera.rotation + degrees),
  });
}

/** Rotates about the view centre. */
export function rotateBy(camera: CameraPose, degrees: number): CameraPose {
  return clampCamera({
    ...camera,
    rotation: normalizedRotation(camera.rotation + degrees),
  });
}

/**
 * Zooms so a bounding box fits inside the viewport, at the current rotation.
 * Mirrors `MapCamera.fit`: measure the rotated extent at zoom 0, then solve for
 * the zoom that makes it fit.
 */
export function fitBounds(
  camera: CameraPose,
  bounds: BoundingBox,
  viewport: Viewport,
  padding = 24,
): CameraPose {
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const centerLon = (bounds.minLon + bounds.maxLon) / 2;

  if (viewport.width <= 0 || viewport.height <= 0) {
    return clampCamera({ ...camera, centerLat, centerLon });
  }

  const corners = [
    worldPoint(bounds.minLat, bounds.minLon, 0),
    worldPoint(bounds.minLat, bounds.maxLon, 0),
    worldPoint(bounds.maxLat, bounds.minLon, 0),
    worldPoint(bounds.maxLat, bounds.maxLon, 0),
  ];
  const radians = (camera.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const xs = corners.map((point) => point.x * cos + point.y * sin);
  const ys = corners.map((point) => -point.x * sin + point.y * cos);
  const width = Math.max(Math.max(...xs) - Math.min(...xs), 1e-9);
  const height = Math.max(Math.max(...ys) - Math.min(...ys), 1e-9);
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const zoom = Math.log2(
    Math.min(availableWidth / width, availableHeight / height),
  );

  return clampCamera({ ...camera, centerLat, centerLon, zoom });
}

/**
 * The camera a saved project opens with, following `ProjectManager.load`:
 * saved camera first, bounding-box centre next, then the app defaults. Zoom
 * falls back to the project's artwork zoom and rotation to its artboard.
 */
export function cameraForProject(project: ProjectSnapshot): CameraPose {
  const box = project.boundingBox;
  return clampCamera({
    centerLat: project.cameraLat ?? (box ? (box.minLat + box.maxLat) / 2 : DEFAULT_CAMERA.centerLat),
    centerLon: project.cameraLon ?? (box ? (box.minLon + box.maxLon) / 2 : DEFAULT_CAMERA.centerLon),
    zoom: project.cameraZoom ?? project.baseZoom ?? DEFAULT_CAMERA.zoom,
    rotation: project.artboardRotation ?? DEFAULT_CAMERA.rotation,
  });
}

export function sameCamera(
  first: CameraPose,
  second: CameraPose,
  epsilon = 1e-7,
): boolean {
  return (
    Math.abs(first.centerLat - second.centerLat) <= epsilon &&
    Math.abs(first.centerLon - second.centerLon) <= epsilon &&
    Math.abs(first.zoom - second.zoom) <= epsilon &&
    Math.abs(first.rotation - second.rotation) <= epsilon
  );
}
