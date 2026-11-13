/**
 * A 2D affine transform in the same layout as a canvas `setTransform` call:
 *
 *     x' = a·x + c·y + e
 *     y' = b·x + d·y + f
 *
 * `core` avoids DOM types, so this small value object stands in for
 * `DOMMatrix` and `CGAffineTransform`. Maps, tiles and vectors all go through
 * one of these, so they cannot disagree about where the camera is.
 */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface Point {
  x: number;
  y: number;
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** Returns `first` applied after `second`, like `CGAffineTransformConcat`. */
export function multiply(first: Affine, second: Affine): Affine {
  return {
    a: second.a * first.a + second.b * first.c,
    b: second.a * first.b + second.b * first.d,
    c: second.c * first.a + second.d * first.c,
    d: second.c * first.b + second.d * first.d,
    e: second.e * first.a + second.f * first.c + first.e,
    f: second.e * first.b + second.f * first.d + first.f,
  };
}

export function invert(transform: Affine): Affine {
  const determinant = transform.a * transform.d - transform.b * transform.c;
  if (!Number.isFinite(determinant) || determinant === 0) {
    throw new RangeError('Affine transform is not invertible');
  }
  const a = transform.d / determinant;
  const b = -transform.b / determinant;
  const c = -transform.c / determinant;
  const d = transform.a / determinant;
  return {
    a,
    b,
    c,
    d,
    e: (transform.c * transform.f - transform.d * transform.e) / determinant,
    f: (transform.b * transform.e - transform.a * transform.f) / determinant,
  };
}

export function apply(transform: Affine, point: Point): Point {
  return {
    x: transform.a * point.x + transform.c * point.y + transform.e,
    y: transform.b * point.x + transform.d * point.y + transform.f,
  };
}

export function translation(x: number, y: number): Affine {
  return { ...IDENTITY, e: x, f: y };
}

export function scaling(x: number, y: number = x): Affine {
  return { a: x, b: 0, c: 0, d: y, e: 0, f: 0 };
}

/** Positive angles turn counter-clockwise in mathematical coordinates. */
export function rotation(radians: number): Affine {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

/** The argument order for `CanvasRenderingContext2D.setTransform`. */
export function toCssMatrix(transform: Affine): string {
  return `matrix(${transform.a}, ${transform.b}, ${transform.c}, ${transform.d}, ${transform.e}, ${transform.f})`;
}
