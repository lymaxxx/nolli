/**
 * Anchor points for polygons, ported from `PolygonCenter.swift`.
 *
 * Rings are arrays of `[lon, lat]`. Every function returns `[lat, lon]`, the
 * opposite order; callers must not mix them up.
 */

type Ring = readonly (readonly number[])[];

/** The plain average of the ring's vertices. */
export function vertexMean(ring: Ring): [number, number] {
  let lon = 0;
  let lat = 0;
  for (const p of ring) {
    lon += p[0]!;
    lat += p[1]!;
  }
  return [lat / ring.length, lon / ring.length];
}

/** The true area centroid (shoelace). It differs from the vertex mean when vertices are unevenly spread. */
export function areaCentroid(ring: Ring): [number, number] {
  const n = ring.length;
  if (n < 3) return vertexMean(ring);
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const p0 = ring[i]!;
    const p1 = ring[(i + 1) % n]!;
    const cross = p0[0]! * p1[1]! - p1[0]! * p0[1]!;
    a += cross;
    cx += (p0[0]! + p1[0]!) * cross;
    cy += (p0[1]! + p1[1]!) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) <= 1e-12) return vertexMean(ring);
  return [cy / (6 * a), cx / (6 * a)];
}

/**
 * An approximate pole of inaccessibility: the interior point farthest from any
 * edge, found by a coarse grid search over the bounding box. Unlike a centroid
 * it always lands inside a concave shape.
 */
export function visualCenter(ring: Ring): [number, number] {
  const n = ring.length;
  if (n < 3) return vertexMean(ring);
  const xs = ring.map((p) => p[0]!);
  const ys = ring.map((p) => p[1]!);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const steps = 18;
  let best: { d: number; x: number; y: number } | undefined;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const x = minX + ((maxX - minX) * i) / steps;
      const y = minY + ((maxY - minY) * j) / steps;
      if (!pointInside(x, y, ring)) continue;
      const d = minEdgeDistance(x, y, ring);
      if (!best || d > best.d) best = { d, x, y };
    }
  }
  return best ? [best.y, best.x] : areaCentroid(ring);
}

function pointInside(px: number, py: number, ring: Ring): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i]![0]!;
    const yi = ring[i]![1]!;
    const xj = ring[j]![0]!;
    const yj = ring[j]![1]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function minEdgeDistance(px: number, py: number, ring: Ring): number {
  let best = Number.POSITIVE_INFINITY;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    best = Math.min(best, pointSegmentDistance(px, py, a[0]!, a[1]!, b[0]!, b[1]!));
  }
  return best;
}

function pointSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
