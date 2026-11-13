/** A point in artwork space (pixels at the project's base zoom, y down). */
export interface Point {
  x: number;
  y: number;
}

/** Position and tangent direction at a distance along a polyline. */
export interface PathSample extends Point {
  /** Tangent angle in radians, measured from +x towards +y (clockwise on screen). */
  angle: number;
}

/** Consecutive points closer than this on both axes are treated as one. */
const DUPLICATE_EPSILON = 0.01;

/**
 * A polyline with cumulative lengths, for sampling by arc distance. The
 * counterpart of `Polyline` in `LabelRendering.swift`: label layout, drawing
 * and export all measure along the same object, so they agree.
 *
 * Near-duplicate consecutive points are dropped on construction, because
 * zero-length segments break offsetting and glyph angles.
 */
export class Polyline {
  readonly points: readonly Point[];
  /** `cumulative[i]` is the arc distance from the start to `points[i]`. */
  readonly cumulative: readonly number[];
  readonly length: number;

  constructor(points: readonly Point[]) {
    const cleaned = dropDuplicates(points);
    if (cleaned.length < 2) throw new Error('A polyline needs at least two distinct points');
    this.points = cleaned;
    const cumulative = [0];
    let total = 0;
    for (let i = 1; i < cleaned.length; i++) {
      const a = cleaned[i - 1]!;
      const b = cleaned[i]!;
      total += Math.hypot(b.x - a.x, b.y - a.y);
      cumulative.push(total);
    }
    this.cumulative = cumulative;
    this.length = total;
  }

  /** A polyline, or null when fewer than two distinct points remain. */
  static tryCreate(points: readonly Point[]): Polyline | null {
    return dropDuplicates(points).length >= 2 ? new Polyline(points) : null;
  }

  /**
   * The point and tangent at `distance` along the line. Distances before the
   * start or past the end continue straight along the first or last segment,
   * so a label that overhangs the line slightly still gets a sensible position.
   */
  sampleAt(distance: number): PathSample {
    const segment = this.segmentIndexAt(distance);
    const a = this.points[segment]!;
    const b = this.points[segment + 1]!;
    const segmentLength = this.cumulative[segment + 1]! - this.cumulative[segment]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = segmentLength === 0 ? 0 : (distance - this.cumulative[segment]!) / segmentLength;
    return { x: a.x + dx * t, y: a.y + dy * t, angle: Math.atan2(dy, dx) };
  }

  /** The point at `distance`, clamped to the line. */
  pointAt(distance: number): Point {
    const { x, y } = this.sampleAt(Math.max(0, Math.min(distance, this.length)));
    return { x, y };
  }

  /**
   * The angle of the straight chord between two distances. This is the stable
   * "tangent" glyphs are rotated by: it matches SVG `textPath` closely and
   * does not jitter at small vertices.
   */
  chordAngle(from: number, to: number): number {
    const a = this.pointAt(from);
    const b = this.pointAt(to);
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  /** The same line travelled the other way. */
  reversed(): Polyline {
    return new Polyline([...this.points].reverse());
  }

  /**
   * The arc distance of the point on the line nearest to `p`. Used to project a
   * drag onto the line when sliding a label along its road.
   */
  nearestDistance(p: Point): number {
    let best = 0;
    let bestSquared = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.points.length - 1; i++) {
      const a = this.points[i]!;
      const b = this.points[i + 1]!;
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const lengthSquared = abx * abx + aby * aby;
      const t =
        lengthSquared > 0
          ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSquared))
          : 0;
      const qx = a.x + abx * t;
      const qy = a.y + aby * t;
      const squared = (p.x - qx) ** 2 + (p.y - qy) ** 2;
      if (squared < bestSquared) {
        bestSquared = squared;
        best = this.cumulative[i]! + Math.sqrt(lengthSquared) * t;
      }
    }
    return best;
  }

  /**
   * Arc distances of interior vertices where the line turns by more than
   * `maxAngleDegrees`: the sharp bends a curved label must not cross.
   */
  sharpVertexDistances(maxAngleDegrees: number): number[] {
    const out: number[] = [];
    for (let i = 1; i < this.points.length - 1; i++) {
      const before = this.points[i - 1]!;
      const here = this.points[i]!;
      const after = this.points[i + 1]!;
      const a1 = Math.atan2(here.y - before.y, here.x - before.x);
      const a2 = Math.atan2(after.y - here.y, after.x - here.x);
      let delta = (Math.abs(a2 - a1) * 180) / Math.PI;
      if (delta > 180) delta = 360 - delta;
      if (delta > maxAngleDegrees) out.push(this.cumulative[i]!);
    }
    return out;
  }

  /**
   * The whole line shifted sideways by `distance`; positive is to the left of
   * the direction of travel, which is "up" for text reading left to right on a
   * y-down screen. Uses averaged vertex normals, with the miter clamped.
   */
  offset(distance: number): Polyline {
    if (distance === 0) return this;
    const count = this.points.length;
    const normals: Point[] = [];
    for (let i = 0; i < count - 1; i++) {
      const a = this.points[i]!;
      const b = this.points[i + 1]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      normals.push(length > 0 ? { x: dy / length, y: -dx / length } : { x: 0, y: 0 });
    }
    const out: Point[] = [];
    for (let i = 0; i < count; i++) {
      let n: Point;
      if (i === 0) n = normals[0]!;
      else if (i === count - 1) n = normals[normals.length - 1]!;
      else {
        const previous = normals[i - 1]!;
        const next = normals[i]!;
        n = { x: (previous.x + next.x) / 2, y: (previous.y + next.y) / 2 };
        const l = Math.hypot(n.x, n.y);
        if (l > 0.05) {
          const scale = Math.min(1 / l, 2);
          n = { x: n.x * scale, y: n.y * scale };
        } else {
          n = previous;
        }
      }
      const p = this.points[i]!;
      out.push({ x: p.x + n.x * distance, y: p.y + n.y * distance });
    }
    // Offsetting cannot normally collapse a line, but if it does keep the original.
    return Polyline.tryCreate(out) ?? this;
  }

  /** Index of the segment containing `distance`, clamped to the first and last. */
  private segmentIndexAt(distance: number): number {
    const last = this.points.length - 2;
    if (distance <= 0) return 0;
    if (distance >= this.length) return last;
    let low = 0;
    let high = last;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.cumulative[mid + 1]! < distance) low = mid + 1;
      else high = mid;
    }
    return low;
  }
}

function dropDuplicates(points: readonly Point[]): Point[] {
  const cleaned: Point[] = [];
  for (const p of points) {
    const last = cleaned[cleaned.length - 1];
    if (last && Math.abs(p.x - last.x) < DUPLICATE_EPSILON && Math.abs(p.y - last.y) < DUPLICATE_EPSILON) {
      continue;
    }
    cleaned.push(p);
  }
  return cleaned;
}
