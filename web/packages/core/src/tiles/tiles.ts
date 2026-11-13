import { apply, invert, type Point } from '../geometry/affine';
import {
  screenTransform,
  TILE_SIZE,
  type Projection,
} from '../projection/projection';
import type { RasterXYZSource } from './TileSource';

export interface TilePlacement {
  z: number;
  /** Unwrapped column, which may be outside 0…n−1 near the antimeridian. */
  x: number;
  y: number;
  /** Column after wrapping, used to fetch and cache the image. */
  wrappedX: number;
}

export interface TileCoverage {
  z: number;
  /** 2^(view zoom − tile zoom); 1 at a whole tile zoom. */
  scale: number;
  tiles: TilePlacement[];
}

export function tileKey(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`;
}

export function tileZoom(zoom: number, source: RasterXYZSource): number {
  return Math.max(source.minZoom, Math.min(source.maxZoom, Math.round(zoom)));
}

export function wrapTileX(x: number, z: number): number {
  const count = 2 ** z;
  return ((x % count) + count) % count;
}

/**
 * One tile's pixel space to screen CSS pixels. This is the same similarity as
 * vector drawing, only at the tile zoom, which is why tiles and vectors stay
 * aligned through any pan, zoom or rotation.
 */
export function tileWorldTransform(projection: Projection, z: number) {
  return screenTransform(projection, z);
}

/**
 * Tiles that cover the viewport, ordered farthest from the centre first.
 * The loader takes requests from the end of its queue, so the middle of the
 * map loads first. Returns null for an empty or implausibly large request.
 */
export function tileCoverage(
  projection: Projection,
  source: RasterXYZSource,
  maxTiles = 4096,
): TileCoverage | null {
  const { width, height } = projection.viewport;
  if (!(width > 0) || !(height > 0)) return null;

  const z = tileZoom(projection.zoom, source);
  const scale = 2 ** (projection.zoom - z);
  const inverse = invert(tileWorldTransform(projection, z));
  const tileCount = 2 ** z;

  const corners: Point[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: 0, y: height },
    { x: width, y: height },
  ].map((point) => apply(inverse, point));

  const minX = Math.floor(Math.min(...corners.map((point) => point.x)) / TILE_SIZE);
  const maxX = Math.ceil(Math.max(...corners.map((point) => point.x)) / TILE_SIZE) - 1;
  const minY = Math.max(
    0,
    Math.floor(Math.min(...corners.map((point) => point.y)) / TILE_SIZE),
  );
  const maxY = Math.min(
    tileCount - 1,
    Math.ceil(Math.max(...corners.map((point) => point.y)) / TILE_SIZE) - 1,
  );

  if (minY > maxY) return null;
  const columns = maxX - minX + 1;
  const rows = maxY - minY + 1;
  if (columns <= 0 || rows <= 0 || columns * rows > maxTiles) return null;

  const center = apply(inverse, { x: width / 2, y: height / 2 });
  const tiles: TilePlacement[] = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      tiles.push({ z, x, y, wrappedX: wrapTileX(x, z) });
    }
  }
  tiles.sort((first, second) => {
    const firstDistance = Math.hypot(
      (first.x * TILE_SIZE + TILE_SIZE / 2 - center.x) / TILE_SIZE,
      (first.y * TILE_SIZE + TILE_SIZE / 2 - center.y) / TILE_SIZE,
    );
    const secondDistance = Math.hypot(
      (second.x * TILE_SIZE + TILE_SIZE / 2 - center.x) / TILE_SIZE,
      (second.y * TILE_SIZE + TILE_SIZE / 2 - center.y) / TILE_SIZE,
    );
    return secondDistance - firstDistance;
  });

  return { z, scale, tiles };
}

export interface AncestorTile {
  z: number;
  x: number;
  y: number;
  /** Crop within the parent image, in parent pixels. */
  sx: number;
  sy: number;
  size: number;
}

/** The parent `depth` levels above a tile, and the crop of it showing that tile. */
export function ancestorTile(
  z: number,
  x: number,
  y: number,
  depth: number,
): AncestorTile | null {
  if (depth < 1 || z - depth < 0) return null;
  const span = 2 ** depth;
  const size = TILE_SIZE / span;
  return {
    z: z - depth,
    x: Math.floor(x / span),
    y: Math.floor(y / span),
    sx: (x % span) * size,
    sy: (y % span) * size,
    size,
  };
}

export interface TileLookup<T> {
  image: T;
  /** Null for an exact tile; a parent crop otherwise. */
  source: { sx: number; sy: number; size: number } | null;
}

/**
 * Bounded LRU cache of decoded tiles. It is generic over the image type so
 * `core` stays free of DOM and Node image APIs.
 */
export class TileCache<T> {
  private readonly entries = new Map<string, T>();

  constructor(
    readonly maxEntries = 1024,
    private readonly onEvict?: (value: T) => void,
  ) {
    if (maxEntries < 1) throw new RangeError('Tile cache needs at least one entry');
  }

  get size(): number {
    return this.entries.size;
  }

  get(z: number, x: number, y: number): T | undefined {
    const key = tileKey(z, x, y);
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    // Re-insert so Map iteration order is least- to most-recently used.
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  has(z: number, x: number, y: number): boolean {
    return this.entries.has(tileKey(z, x, y));
  }

  set(z: number, x: number, y: number, value: T): void {
    const key = tileKey(z, x, y);
    const previous = this.entries.get(key);
    if (previous !== undefined && previous !== value) this.onEvict?.(previous);
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      const evicted = this.entries.get(oldest.value);
      this.entries.delete(oldest.value);
      if (evicted !== undefined) this.onEvict?.(evicted);
    }
  }

  delete(z: number, x: number, y: number): void {
    const key = tileKey(z, x, y);
    const removed = this.entries.get(key);
    if (removed !== undefined) {
      this.entries.delete(key);
      this.onEvict?.(removed);
    }
  }

  clear(): void {
    const values = [...this.entries.values()];
    this.entries.clear();
    for (const value of values) this.onEvict?.(value);
  }

  /**
   * Exact tile if present, otherwise the nearest cached ancestor. The crop is
   * scaled over the missing tile so nothing flashes blank while it loads.
   */
  lookupWithParent(
    z: number,
    x: number,
    y: number,
    maxDepth = 5,
  ): TileLookup<T> | null {
    const exact = this.get(z, x, y);
    if (exact !== undefined) return { image: exact, source: null };

    for (let depth = 1; depth <= maxDepth; depth += 1) {
      const parent = ancestorTile(z, x, y, depth);
      if (!parent) break;
      const image = this.get(parent.z, parent.x, parent.y);
      if (image !== undefined) {
        return { image, source: { sx: parent.sx, sy: parent.sy, size: parent.size } };
      }
    }
    return null;
  }
}
