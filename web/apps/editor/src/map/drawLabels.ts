import {
  artworkTransform,
  cssColor,
  sceneCullRect,
  type LabelGeometry,
  type LabelRun,
  type LoadedFont,
  type Projection,
  type Scene,
} from '@nolli/core';
import { applyBaseTransform, type DrawingContext, type SurfaceMetrics } from './surface';

const glyphPaths = new WeakMap<LoadedFont, Map<number, Path2D>>();
const runPaths = new WeakMap<LabelRun, Path2D>();

function glyphPath(font: LoadedFont, glyphId: number): Path2D {
  let cache = glyphPaths.get(font);
  if (!cache) {
    cache = new Map();
    glyphPaths.set(font, cache);
  }
  let path = cache.get(glyphId);
  if (!path) {
    path = new Path2D(font.glyphOutline(glyphId));
    cache.set(glyphId, path);
  }
  return path;
}

/** One path for the whole run, in local artwork space, so halo and fill share exact outlines. */
function pathOf(run: LabelRun): Path2D {
  let path = runPaths.get(run);
  if (!path) {
    path = new Path2D();
    for (const glyph of run.glyphs) path.addPath(glyphPath(glyph.font, glyph.glyphId), glyph.matrix);
    runPaths.set(run, path);
  }
  return path;
}

function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

function drawCallout(ctx: DrawingContext, label: LabelGeometry): void {
  const target = label.callout;
  if (!target) return;
  const style = label.style;
  const a = label.anchor;
  ctx.save();
  ctx.strokeStyle = cssColor(style.calloutColor);
  ctx.lineWidth = style.calloutWidth;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(target.x, target.y);
  switch (style.calloutStyle) {
    case 'simple_line':
    case 'balloon':
      ctx.lineTo(a.x, a.y);
      break;
    case 'manhattan':
      ctx.lineTo(target.x, a.y);
      ctx.lineTo(a.x, a.y);
      break;
    case 'curved':
      ctx.quadraticCurveTo(target.x, a.y, a.x, a.y);
      break;
  }
  ctx.stroke();
  if (style.calloutStyle === 'balloon') {
    ctx.fillStyle = cssColor(style.calloutColor);
    ctx.beginPath();
    ctx.arc(target.x, target.y, style.calloutWidth * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Draws placed labels over the vectors, ported from `MapSceneRenderer.draw`.
 * Placement does not depend on the view, only which way a road name reads does:
 * a name is drawn the way up that points towards the top of the screen.
 */
export function drawLabels(
  ctx: DrawingContext,
  labels: readonly LabelGeometry[],
  scene: Scene,
  projection: Projection,
  metrics: SurfaceMetrics,
): void {
  if (labels.length === 0) return;
  const transform = artworkTransform(projection, scene.baseZoom, scene.origin);
  const cull = sceneCullRect(scene, projection, {
    x: -metrics.offsetX,
    y: -metrics.offsetY,
    width: metrics.cssWidth,
    height: metrics.cssHeight,
  });
  const rotation = (projection.rotation * Math.PI) / 180;
  // Pixels on screen per artwork pixel, for shadows, which the canvas measures in device pixels.
  const scale = 2 ** (projection.zoom - scene.baseZoom) * metrics.dpr;

  ctx.save();
  applyBaseTransform(ctx, metrics);
  ctx.transform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
  ctx.lineJoin = 'round';

  for (const label of labels) {
    if (!intersects(label.bounds, cull)) continue;
    const style = label.style;
    ctx.save();
    drawCallout(ctx, label);

    let run: LabelRun;
    if (label.upright) {
      ctx.translate(label.anchor.x, label.anchor.y);
      ctx.rotate(rotation);
      run = label.forward;
    } else {
      run = Math.cos(label.chord - rotation) < 0 ? (label.reverse ?? label.forward) : label.forward;
    }
    const path = pathOf(run);

    if (style.bufferEnabled && style.haloWidth > 0) {
      ctx.strokeStyle = cssColor(style.haloColor, style.bufferOpacity);
      ctx.lineWidth = style.haloWidth * 2;
      ctx.lineJoin = style.bufferJoinStyle;
      ctx.lineCap = 'round';
      ctx.stroke(path);
    }
    if (style.shadowEnabled) {
      ctx.shadowColor = cssColor(style.shadowColor, style.shadowOpacity);
      ctx.shadowOffsetX = style.shadowOffsetX * scale;
      ctx.shadowOffsetY = style.shadowOffsetY * scale;
      ctx.shadowBlur = style.shadowBlur * scale;
    }
    ctx.fillStyle = cssColor(style.color, style.opacity);
    ctx.fill(path);
    ctx.restore();
  }
  ctx.restore();
}
