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

/** A polyline with cumulative lengths, for sampling by arc distance. */
export class Polyline {
  readonly points: readonly Point[];
  /** `cumulative[i]` is the arc distance from the start to `points[i]`. */
  readonly cumulative: readonly number[];
  readonly length: number;

  constructor(points: readonly Point[]) {
    if (points.length < 2) throw new Error('A polyline needs at least two points');
    this.points = points;
    const cumulative = [0];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      total += Math.hypot(b.x - a.x, b.y - a.y);
      cumulative.push(total);
    }
    this.cumulative = cumulative;
    this.length = total;
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
