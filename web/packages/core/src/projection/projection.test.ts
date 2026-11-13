import { describe, expect, it } from 'vitest';
import { apply, invert } from '../geometry/affine';
import {
  artworkTransform,
  fromScreen,
  fromScreenWorld,
  latLonAt,
  projectionOf,
  relativeScreenTransform,
  screenTransform,
  toScreen,
  toScreenWorld,
  worldDeltaFromScreen,
  worldPoint,
  type CameraPose,
  type Viewport,
} from './projection';

const viewport: Viewport = { width: 900, height: 640 };

function pose(partial: Partial<CameraPose> = {}): CameraPose {
  return {
    centerLat: 54.66,
    centerLon: -2.75,
    zoom: 16.5,
    rotation: 0,
    ...partial,
  };
}

describe('Web Mercator projection', () => {
  it('puts the null island at the centre of the zoom-0 world', () => {
    expect(worldPoint(0, 0, 0)).toEqual({ x: 128, y: 128 });
    expect(worldPoint(0, 180, 0).x).toBe(256);
    expect(worldPoint(0, -180, 0).x).toBe(0);
  });

  it('round-trips geographic and world coordinates', () => {
    const world = worldPoint(51.505, -0.09, 17);
    const back = latLonAt(world, 17);
    expect(back.lat).toBeCloseTo(51.505, 10);
    expect(back.lon).toBeCloseTo(-0.09, 10);
  });

  it('clamps the poles instead of returning infinity', () => {
    expect(Number.isFinite(worldPoint(90, 0, 4).y)).toBe(true);
    expect(Number.isFinite(worldPoint(-90, 0, 4).y)).toBe(true);
  });

  it('inverts screen projection at any rotation', () => {
    for (const rotation of [0, 12.5, 90, -137]) {
      const projection = projectionOf(pose({ rotation }), viewport);
      const screen = toScreen(projection, 54.668, -2.741);
      const geographic = fromScreen(projection, screen.x, screen.y);
      expect(geographic.lat).toBeCloseTo(54.668, 9);
      expect(geographic.lon).toBeCloseTo(-2.741, 9);
    }
  });

  it('maps artwork space exactly like direct screen projection', () => {
    const camera = pose({ rotation: 23 });
    const projection = projectionOf(camera, viewport);
    const baseZoom = 17;
    const origin = { x: 12345.6, y: 67890.1 };
    const transform = artworkTransform(projection, baseZoom, origin);

    for (const [lat, lon] of [
      [54.66, -2.75],
      [54.667, -2.744],
      [54.656, -2.758],
    ] as const) {
      const world = worldPoint(lat, lon, baseZoom);
      const direct = toScreen(projection, lat, lon);
      const throughMatrix = apply(transform, {
        x: world.x - origin.x,
        y: world.y - origin.y,
      });
      expect(throughMatrix.x).toBeCloseTo(direct.x, 8);
      expect(throughMatrix.y).toBeCloseTo(direct.y, 8);
    }
  });

  it('uses the same similarity for tiles and vectors', () => {
    const projection = projectionOf(pose({ rotation: -31, zoom: 15.3 }), viewport);
    const baseZoom = 17;
    const z = 16;
    const origin = { x: 5000, y: 7000 };
    const tileTransform = screenTransform(projection, z);
    const artwork = artworkTransform(projection, baseZoom, origin);
    const worldAtBase = worldPoint(54.661, -2.747, baseZoom);
    const local = { x: worldAtBase.x - origin.x, y: worldAtBase.y - origin.y };
    const worldAtTileZoom = worldPoint(54.661, -2.747, z);

    const fromArtwork = apply(artwork, local);
    const fromTile = apply(tileTransform, worldAtTileZoom);
    expect(fromTile.x).toBeCloseTo(fromArtwork.x, 8);
    expect(fromTile.y).toBeCloseTo(fromArtwork.y, 8);
  });

  it('builds a relative transform that moves a frame between cameras', () => {
    const from = projectionOf(pose({ rotation: 0, zoom: 16 }), viewport);
    const to = projectionOf(
      pose({ centerLat: 54.662, centerLon: -2.746, rotation: 17, zoom: 17.25 }),
      viewport,
    );
    const transform = relativeScreenTransform(from, to);
    const world = worldPoint(54.665, -2.752, 17);

    const before = toScreenWorld(from, world, 17);
    const after = toScreenWorld(to, world, 17);
    const moved = apply(transform, before);
    expect(moved.x).toBeCloseTo(after.x, 8);
    expect(moved.y).toBeCloseTo(after.y, 8);
  });

  it('converts a screen drag into artwork space', () => {
    const projection = projectionOf(pose({ rotation: 40, zoom: 18 }), viewport);
    const delta = worldDeltaFromScreen(projection, 30, -12, 17);
    const transform = artworkTransform(projection, 17, { x: 0, y: 0 });
    const inverse = invert(transform);
    const screen = apply(transform, delta);
    const back = apply(inverse, screen);
    expect(back.x).toBeCloseTo(delta.x, 8);
    expect(back.y).toBeCloseTo(delta.y, 8);
  });

  it('keeps the world point under a screen point when reading it back', () => {
    const projection = projectionOf(pose({ rotation: 61 }), viewport);
    const world = fromScreenWorld(projection, 411, 207, 0);
    const screen = toScreenWorld(projection, world, 0);
    expect(screen.x).toBeCloseTo(411, 8);
    expect(screen.y).toBeCloseTo(207, 8);
  });
});
