import { describe, expect, it } from 'vitest';
import { apply, invert } from '../geometry/affine';
import { projectionOf, latLonAt, toScreen } from '../projection/projection';
import { OSM_STANDARD } from './TileSource';
import {
  ancestorTile,
  TileCache,
  tileCoverage,
  tileWorldTransform,
  tileZoom,
  wrapTileX,
} from './tiles';

const viewport = { width: 512, height: 512 };

function projection(partial: { centerLat?: number; centerLon?: number; zoom?: number; rotation?: number } = {}) {
  return projectionOf(
    {
      centerLat: partial.centerLat ?? 0,
      centerLon: partial.centerLon ?? 0,
      zoom: partial.zoom ?? 2,
      rotation: partial.rotation ?? 0,
    },
    viewport,
  );
}

describe('tile selection', () => {
  it('rounds to a tile zoom and clamps to the source range', () => {
    expect(tileZoom(2.4, OSM_STANDARD)).toBe(2);
    expect(tileZoom(2.6, OSM_STANDARD)).toBe(3);
    expect(tileZoom(-4, OSM_STANDARD)).toBe(0);
    expect(tileZoom(30, OSM_STANDARD)).toBe(19);
  });

  it('covers a view with whole tiles', () => {
    const coverage = tileCoverage(projection(), OSM_STANDARD);
    expect(coverage).not.toBeNull();
    expect(coverage!.z).toBe(2);
    expect(coverage!.scale).toBe(1);
    expect(coverage!.tiles).toHaveLength(4);
    expect(
      coverage!.tiles
        .map((tile) => `${tile.wrappedX}/${tile.y}`)
        .sort(),
    ).toEqual(['1/1', '1/2', '2/1', '2/2']);
  });

  it('keeps the coverage correct under rotation', () => {
    const proj = projection({ rotation: 37, zoom: 2.4 });
    const coverage = tileCoverage(proj, OSM_STANDARD);
    expect(coverage).not.toBeNull();
    const inverse = invert(tileWorldTransform(proj, coverage!.z));
    const tiles = new Set(coverage!.tiles.map((tile) => `${tile.x}/${tile.y}`));

    for (const corner of [
      { x: 0, y: 0 },
      { x: viewport.width, y: 0 },
      { x: 0, y: viewport.height },
      { x: viewport.width, y: viewport.height },
    ]) {
      const tilePoint = apply(inverse, corner);
      expect(tiles.has(`${Math.floor(tilePoint.x / 256)}/${Math.floor(tilePoint.y / 256)}`)).toBe(
        true,
      );
    }
  });

  it('wraps columns across the antimeridian', () => {
    expect(wrapTileX(-1, 2)).toBe(3);
    expect(wrapTileX(5, 2)).toBe(1);
    expect(tileCoverage(projection({ centerLon: 179.9, zoom: 3 }), OSM_STANDARD)).not.toBeNull();
  });

  it('places a tile corner exactly where the vector projection puts it', () => {
    const proj = projection({ centerLat: 54.66, centerLon: -2.75, zoom: 16.4, rotation: -21 });
    const z = 16;
    const transform = tileWorldTransform(proj, z);
    const tilePoint = { x: 64500 * 256, y: 41800 * 256 };
    const screen = apply(transform, tilePoint);
    const geographic = latLonAt(tilePoint, z);
    const direct = toScreen(proj, geographic.lat, geographic.lon);
    expect(screen.x).toBeCloseTo(direct.x, 8);
    expect(screen.y).toBeCloseTo(direct.y, 8);
  });

  it('reflects the chosen tile zoom in the scale', () => {
    const coverage = tileCoverage(projection({ zoom: 2.5 }), OSM_STANDARD);
    expect(coverage!.z).toBe(3);
    expect(coverage!.scale).toBeCloseTo(2 ** -0.5, 12);
  });

  it('refuses an implausibly large request', () => {
    expect(tileCoverage(projection({ zoom: 0 }), OSM_STANDARD, 1)).toBeNull();
  });

  it('computes parent crops', () => {
    expect(ancestorTile(12, 10, 14, 2)).toEqual({
      z: 10,
      x: 2,
      y: 3,
      sx: 128,
      sy: 128,
      size: 64,
    });
    expect(ancestorTile(1, 0, 0, 2)).toBeNull();
  });
});

describe('tile cache', () => {
  it('evicts the least recently used entry', () => {
    const cache = new TileCache<string>(2);
    cache.set(1, 0, 0, 'a');
    cache.set(1, 1, 0, 'b');
    expect(cache.get(1, 0, 0)).toBe('a');
    cache.set(1, 2, 0, 'c');

    expect(cache.size).toBe(2);
    expect(cache.get(1, 1, 0)).toBeUndefined();
    expect(cache.get(1, 0, 0)).toBe('a');
    expect(cache.get(1, 2, 0)).toBe('c');
  });

  it('falls back to the nearest cached parent', () => {
    const cache = new TileCache<string>();
    cache.set(10, 2, 3, 'parent');
    expect(cache.lookupWithParent(12, 10, 14)).toEqual({
      image: 'parent',
      source: { sx: 128, sy: 128, size: 64 },
    });
  });

  it('prefers an exact tile and ignores far-away parents', () => {
    const cache = new TileCache<string>();
    cache.set(12, 10, 14, 'exact');
    cache.set(10, 2, 3, 'parent');
    expect(cache.lookupWithParent(12, 10, 14)).toEqual({ image: 'exact', source: null });
    expect(cache.lookupWithParent(15, 1, 1, 1)).toBeNull();
  });
});
