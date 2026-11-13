import type { Affine, Viewport } from '@nolli/core';

export type DrawingContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** 
 * Extra map drawn around the visible viewport. Gestures move the finished
 * bitmap with CSS before the worker replaces it; without this margin those
 * moves would expose blank edges. The native app keeps the same kind of
 * overscan for the same reason.
 */
export const MAP_OVERSCAN = 0.2;

export interface SurfaceMetrics {
  /** CSS size of the whole bitmap, including overscan. */
  cssWidth: number;
  cssHeight: number;
  /** Where the visible viewport sits inside that bitmap. */
  offsetX: number;
  offsetY: number;
  dpr: number;
}

export function surfaceMetrics(
  viewport: Viewport,
  dpr: number,
  overscan: number = MAP_OVERSCAN,
): SurfaceMetrics {
  const offsetX = viewport.width * overscan;
  const offsetY = viewport.height * overscan;
  return {
    cssWidth: viewport.width + offsetX * 2,
    cssHeight: viewport.height + offsetY * 2,
    offsetX,
    offsetY,
    dpr,
  };
}

/**
 * The bitmap's pixel space starts at the overscan corner; everything drawn in
 * viewport coordinates is shifted by that offset. The device pixel ratio is
 * applied at the same time so the worker draws in CSS pixels.
 */
export function applyBaseTransform(ctx: DrawingContext, metrics: SurfaceMetrics): void {
  ctx.setTransform(
    metrics.dpr,
    0,
    0,
    metrics.dpr,
    metrics.offsetX * metrics.dpr,
    metrics.offsetY * metrics.dpr,
  );
}

/**
 * A gesture transform is expressed in viewport coordinates. The canvas bitmap
 * is larger and sits at `-offset`, so its own local coordinates are shifted by
 * that offset. This corrects the translation while leaving rotation and scale
 * alone.
 */
export function compensateOverscan(transform: Affine, metrics: SurfaceMetrics): Affine {
  const { offsetX, offsetY } = metrics;
  return {
    ...transform,
    e:
      transform.e -
      (transform.a * offsetX + transform.c * offsetY) +
      offsetX,
    f:
      transform.f -
      (transform.b * offsetX + transform.d * offsetY) +
      offsetY,
  };
}
