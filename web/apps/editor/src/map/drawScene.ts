import {
  artworkTransform,
  cellIntersects,
  sceneCullRect,
  type Projection,
  type Scene,
  type SceneCell,
  type ScenePath,
} from '@nolli/core';
import {
  applyBaseTransform,
  type DrawingContext,
  type SurfaceMetrics,
} from './surface';

function addPath(ctx: DrawingContext, path: ScenePath): void {
  if (path.kind === 'polyline') {
    const points = path.points;
    if (points.length < 4) return;
    ctx.moveTo(points[0]!, points[1]!);
    for (let index = 2; index + 1 < points.length; index += 2) {
      ctx.lineTo(points[index]!, points[index + 1]!);
    }
    return;
  }

  for (const ring of path.rings) {
    if (ring.length < 4) continue;
    ctx.moveTo(ring[0]!, ring[1]!);
    for (let index = 2; index + 1 < ring.length; index += 2) {
      ctx.lineTo(ring[index]!, ring[index + 1]!);
    }
    ctx.closePath();
  }
}

function addCell(ctx: DrawingContext, cell: SceneCell): void {
  ctx.beginPath();
  for (const path of cell.paths) addPath(ctx, path);
}

function markerPath(
  ctx: DrawingContext,
  shape: 'circle' | 'square' | 'diamond',
  x: number,
  y: number,
  radius: number,
): void {
  ctx.beginPath();
  switch (shape) {
    case 'circle':
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      break;
    case 'square':
      ctx.rect(x - radius, y - radius, radius * 2, radius * 2);
      break;
    case 'diamond':
      ctx.moveTo(x, y - radius);
      ctx.lineTo(x + radius, y);
      ctx.lineTo(x, y + radius);
      ctx.lineTo(x - radius, y);
      ctx.closePath();
      break;
  }
}

/**
 * Draws the compiled vectors in artwork space through the camera's artwork
 * transform. The context is already in device pixels, so one `transform` call
 * positions every layer, stroke width and marker on the same CTM as the
 * tiles.
 */
export function drawScene(
  ctx: DrawingContext,
  scene: Scene,
  projection: Projection,
  metrics: SurfaceMetrics,
): void {
  const transform = artworkTransform(projection, scene.baseZoom, scene.origin);
  const cull = sceneCullRect(scene, projection, {
    x: -metrics.offsetX,
    y: -metrics.offsetY,
    width: metrics.cssWidth,
    height: metrics.cssHeight,
  });

  ctx.save();
  applyBaseTransform(ctx, metrics);
  ctx.transform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
  ctx.lineJoin = 'round';

  // The native renderer appends point markers between layer batches, so a
  // point layer below a line layer stays below it.
  const drawables: Array<{
    sequence: number;
    batch?: Scene['batches'][number];
    markers?: Scene['markers'][number];
  }> = [
    ...scene.batches.map((batch) => ({ sequence: batch.sequence, batch })),
    ...scene.markers.map((markers) => ({ sequence: markers.sequence, markers })),
  ].sort((first, second) => first.sequence - second.sequence);

  for (const item of drawables) {
    const batch = item.batch;
    if (batch) {
      if (batch.fill) {
        ctx.fillStyle = batch.fill;
        for (const cell of batch.cells) {
          if (!cellIntersects(cell, cull)) continue;
          addCell(ctx, cell);
          ctx.fill(batch.evenOdd ? 'evenodd' : 'nonzero');
        }
      }

      if (batch.stroke && batch.lineWidth > 0) {
        ctx.strokeStyle = batch.stroke;
        ctx.lineWidth = batch.lineWidth;
        ctx.lineCap = batch.cap;
        ctx.lineJoin = batch.join;
        for (const cell of batch.cells) {
          if (!cellIntersects(cell, cull, batch.lineWidth)) continue;
          addCell(ctx, cell);
          ctx.stroke();
        }
      }
      continue;
    }

    const markers = item.markers;
    if (!markers) continue;
    ctx.fillStyle = markers.fill;
    if (markers.stroke && markers.strokeWidth > 0) {
      ctx.strokeStyle = markers.stroke;
      ctx.lineWidth = markers.strokeWidth;
    }
    const radius = markers.size / 2;
    for (const marker of markers.markers) {
      if (
        marker.x + radius < cull.x ||
        marker.x - radius > cull.x + cull.width ||
        marker.y + radius < cull.y ||
        marker.y - radius > cull.y + cull.height
      ) {
        continue;
      }
      markerPath(ctx, markers.shape, marker.x, marker.y, radius);
      ctx.fill();
      if (markers.stroke && markers.strokeWidth > 0) ctx.stroke();
    }
  }

  ctx.restore();
}
