import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT_FIELDS, type BoundingBox, type ProjectSnapshot } from '../model/project';
import { fromScreen, projectionOf, toScreen } from '../projection/projection';
import type { CameraPose } from '../projection/projection';
import {
  cameraForProject,
  clampCamera,
  fitBounds,
  MAX_LAT,
  MAX_ZOOM,
  MIN_LAT,
  MIN_ZOOM,
  normalizedRotation,
  panBy,
  rotateAround,
  rotateBy,
  sameCamera,
  zoomAround,
} from './camera';

const viewport = { width: 1000, height: 700 };
const anchor = { x: 730, y: 190 };

function pose(partial: Partial<CameraPose> = {}): CameraPose {
  return {
    centerLat: 54.66,
    centerLon: -2.75,
    zoom: 16,
    rotation: 0,
    ...partial,
  };
}

function project(partial: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return { ...DEFAULT_PROJECT_FIELDS, ...partial };
}

describe('camera', () => {
  it('zooms around an anchor without moving the point under it', () => {
    const camera = pose({ rotation: 19 });
    const before = fromScreen(projectionOf(camera, viewport), anchor.x, anchor.y);
    const next = zoomAround(camera, camera.zoom + 2.25, anchor, viewport);
    const after = fromScreen(projectionOf(next, viewport), anchor.x, anchor.y);

    expect(next.zoom).toBeCloseTo(camera.zoom + 2.25, 12);
    expect(after.lat).toBeCloseTo(before.lat, 9);
    expect(after.lon).toBeCloseTo(before.lon, 9);
  });

  it('does not accumulate latitude drift over many zoom steps', () => {
    let camera = pose({ rotation: -33 });
    const before = fromScreen(projectionOf(camera, viewport), anchor.x, anchor.y);
    for (let step = 0; step < 60; step += 1) {
      camera = zoomAround(camera, camera.zoom + (step % 2 === 0 ? 0.35 : -0.35), anchor, viewport);
    }
    const after = fromScreen(projectionOf(camera, viewport), anchor.x, anchor.y);
    expect(after.lat).toBeCloseTo(before.lat, 8);
    expect(after.lon).toBeCloseTo(before.lon, 8);
  });

  it('pans content with the pointer', () => {
    const camera = pose({ rotation: 28 });
    const projection = projectionOf(camera, viewport);
    const geographic = fromScreen(projection, 240, 320);
    const next = panBy(camera, 45, -30, viewport);
    const screen = toScreen(projectionOf(next, viewport), geographic.lat, geographic.lon);

    expect(screen.x).toBeCloseTo(285, 8);
    expect(screen.y).toBeCloseTo(290, 8);
  });

  it('rotates around an anchor without moving the point under it', () => {
    const camera = pose({ rotation: 10, zoom: 17 });
    const before = fromScreen(projectionOf(camera, viewport), anchor.x, anchor.y);
    const next = rotateAround(camera, 37, anchor, viewport);
    const after = fromScreen(projectionOf(next, viewport), anchor.x, anchor.y);

    expect(next.rotation).toBeCloseTo(47, 12);
    expect(after.lat).toBeCloseTo(before.lat, 9);
    expect(after.lon).toBeCloseTo(before.lon, 9);
  });

  it('normalises rotation and clamps zoom and latitude', () => {
    expect(normalizedRotation(190)).toBe(-170);
    expect(normalizedRotation(-190)).toBe(170);
    expect(normalizedRotation(180)).toBe(180);
    expect(normalizedRotation(-180)).toBe(180);
    expect(normalizedRotation(720)).toBe(0);

    const camera = clampCamera({
      centerLat: 100,
      centerLon: 400,
      zoom: 100,
      rotation: 540,
    });
    expect(camera.centerLat).toBe(MAX_LAT);
    expect(camera.zoom).toBe(MAX_ZOOM);
    expect(camera.rotation).toBe(180);
    expect(clampCamera({ ...camera, centerLat: -100 }).centerLat).toBe(MIN_LAT);
    expect(clampCamera({ ...camera, zoom: -4 }).zoom).toBe(MIN_ZOOM);
  });

  it('fits a bounding box inside the viewport at the current rotation', () => {
    const bounds: BoundingBox = {
      minLat: 54.655,
      minLon: -2.762,
      maxLat: 54.67,
      maxLon: -2.739,
    };
    const next = fitBounds(pose({ rotation: 18 }), bounds, viewport, 24);
    const projection = projectionOf(next, viewport);
    const corners = [
      toScreen(projection, bounds.minLat, bounds.minLon),
      toScreen(projection, bounds.minLat, bounds.maxLon),
      toScreen(projection, bounds.maxLat, bounds.minLon),
      toScreen(projection, bounds.maxLat, bounds.maxLon),
    ];

    for (const corner of corners) {
      expect(corner.x).toBeGreaterThanOrEqual(23);
      expect(corner.x).toBeLessThanOrEqual(viewport.width - 23);
      expect(corner.y).toBeGreaterThanOrEqual(23);
      expect(corner.y).toBeLessThanOrEqual(viewport.height - 23);
    }
  });

  it('opens a project with its saved camera, then the bounding box, then defaults', () => {
    const bounds: BoundingBox = {
      minLat: 10,
      minLon: 20,
      maxLat: 12,
      maxLon: 24,
    };
    const saved = cameraForProject(
      project({
        boundingBox: bounds,
        cameraLat: 11.25,
        cameraLon: 21.5,
        cameraZoom: 18.75,
        artboardRotation: 12.5,
        baseZoom: 17,
      }),
    );
    expect(saved).toEqual({
      centerLat: 11.25,
      centerLon: 21.5,
      zoom: 18.75,
      rotation: 12.5,
    });

    const legacy = cameraForProject(
      project({ boundingBox: bounds, baseZoom: 16, artboardRotation: -7 }),
    );
    expect(legacy.centerLat).toBe(11);
    expect(legacy.centerLon).toBe(22);
    expect(legacy.zoom).toBe(16);
    expect(legacy.rotation).toBe(-7);

    const empty = cameraForProject(project({ baseZoom: 15, artboardRotation: 0 }));
    expect(empty.centerLat).toBe(51.505);
    expect(empty.centerLon).toBe(-0.09);
  });

  it('compares cameras for render-frame bookkeeping', () => {
    expect(sameCamera(pose(), pose())).toBe(true);
    expect(sameCamera(pose(), pose({ zoom: 16.0001 }))).toBe(false);
    expect(sameCamera(pose(), rotateBy(pose(), 0))).toBe(true);
  });
});
