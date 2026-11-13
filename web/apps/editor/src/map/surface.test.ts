import { applyAffine, IDENTITY_AFFINE, type Affine } from '@nolli/core';
import { describe, expect, it } from 'vitest';
import { compensateOverscan, surfaceMetrics } from './surface';

const viewport = { width: 1000, height: 600 };

describe('gesture surface', () => {
  it('adds overscan around the viewport', () => {
    const metrics = surfaceMetrics(viewport, 2);
    expect(metrics).toMatchObject({
      cssWidth: 1400,
      cssHeight: 840,
      offsetX: 200,
      offsetY: 120,
      dpr: 2,
    });
  });

  it('leaves an identity transform alone', () => {
    const metrics = surfaceMetrics(viewport, 1);
    expect(compensateOverscan(IDENTITY_AFFINE, metrics)).toEqual(IDENTITY_AFFINE);
  });

  it('maps bitmap-local points to the same viewport point as the gesture transform', () => {
    const metrics = surfaceMetrics(viewport, 1);
    const transform: Affine = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
    const adjusted = compensateOverscan(transform, metrics);
    const local = { x: 100, y: 50 };

    const before = { x: local.x - metrics.offsetX, y: local.y - metrics.offsetY };
    const expected = applyAffine(transform, before);
    const displayed = applyAffine(adjusted, local);
    expect(displayed.x - metrics.offsetX).toBeCloseTo(expected.x, 10);
    expect(displayed.y - metrics.offsetY).toBeCloseTo(expected.y, 10);
  });

  it('keeps a pan transform unchanged', () => {
    const metrics = surfaceMetrics(viewport, 1);
    const transform: Affine = { a: 1, b: 0, c: 0, d: 1, e: 30, f: -12 };
    expect(compensateOverscan(transform, metrics)).toEqual(transform);
  });
});
