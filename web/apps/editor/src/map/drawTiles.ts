import {
  TILE_SIZE,
  tileCoverage,
  tileWorldTransform,
  type Projection,
  type RasterXYZSource,
} from '@nolli/core';
import type { TileLoader } from './tileStore';
import {
  applyBaseTransform,
  type DrawingContext,
  type SurfaceMetrics,
} from './surface';

export interface TileDrawResult {
  tileCount: number;
  missingTiles: number;
}

/**
 * Draws the reference tiles through the same camera as the vectors. The tile
 * matrix is the one artwork matrix at another zoom, so pan/zoom/rotation can
 * never pull the two apart.
 */
export function drawTiles(
  ctx: DrawingContext,
  projection: Projection,
  source: RasterXYZSource,
  loader: TileLoader,
  metrics: SurfaceMetrics,
  opacity: number,
): TileDrawResult {
  const coverage = tileCoverage(projection, source, 2048);
  if (!coverage) return { tileCount: 0, missingTiles: 0 };

  const transform = tileWorldTransform(projection, coverage.z);
  let tileCount = 0;
  let missingTiles = 0;

  ctx.save();
  applyBaseTransform(ctx, metrics);
  ctx.transform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  ctx.imageSmoothingEnabled =
    Math.abs(coverage.scale - 1) > 1e-3 || projection.rotation !== 0;
  ctx.imageSmoothingQuality = 'medium';

  for (const tile of coverage.tiles) {
    const x = tile.x * TILE_SIZE;
    const y = tile.y * TILE_SIZE;
    const found = loader.lookup(tile.z, tile.wrappedX, tile.y);
    if (!found) {
      loader.request(tile.z, tile.wrappedX, tile.y);
      missingTiles += 1;
      continue;
    }

    if (found.source) {
      const { sx, sy, size } = found.source;
      ctx.drawImage(found.image, sx, sy, size, size, x, y, TILE_SIZE, TILE_SIZE);
    } else {
      ctx.drawImage(found.image, x, y, TILE_SIZE, TILE_SIZE);
    }
    tileCount += 1;
  }

  ctx.restore();
  return { tileCount, missingTiles };
}
