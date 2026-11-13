import { Polyline, type Point } from '../geo/polyline';
import type { ShapedGlyph, ShapedLine } from './shape';

/** A unit of text placed on a path: draw its glyphs in a frame at `origin`, rotated by `angle`. */
export interface PlacedUnit {
  /** The unit's left end on the baseline, in artwork pixels. */
  origin: Point;
  /** Rotation in radians, clockwise on screen (y down). */
  angle: number;
  /** Glyph positions inside the unit, in ems (multiply by the font size), y up. */
  glyphs: readonly ShapedGlyph[];
}

export interface PathTextOptions {
  /** Font size in artwork pixels. */
  fontSize: number;
  /** Arc distance from the start of the path to the middle of the text. Defaults to the path's middle. */
  centerAt?: number;
  /** Shift off the path, in artwork pixels. Positive moves the baseline to the left of the direction of travel (up, for a path running left to right). */
  baselineShift?: number;
}

export interface PathTextResult {
  units: PlacedUnit[];
  /** Arc distances of the text's two ends. They can lie outside `[0, path length]` if the text is longer than the path. */
  startDistance: number;
  endDistance: number;
  /** The largest change of direction between neighbouring units, in radians: how hard the text bends. */
  maxBend: number;
}

/**
 * Lay a shaped line along a path.
 *
 * Each unit is treated as rigid: it sits tangent to the path at the unit's
 * middle. The line's left end is placed towards the start of the path, so the
 * caller decides reading direction by choosing which way the path runs.
 */
export function placeOnPath(
  line: ShapedLine,
  path: Polyline | readonly Point[],
  options: PathTextOptions,
): PathTextResult {
  const polyline = path instanceof Polyline ? path : new Polyline(path);
  const { fontSize } = options;
  const width = line.advance * fontSize;
  const startDistance = (options.centerAt ?? polyline.length / 2) - width / 2;
  const shift = options.baselineShift ?? 0;

  const units: PlacedUnit[] = [];
  let maxBend = 0;
  let previousAngle: number | undefined;
  let cursor = startDistance;
  for (const unit of line.units) {
    const unitWidth = unit.advance * fontSize;
    if (!unit.isSpace && unit.glyphs.length > 0) {
      const middle = polyline.sampleAt(cursor + unitWidth / 2);
      const cos = Math.cos(middle.angle);
      const sin = Math.sin(middle.angle);
      // Step back half the unit along the tangent, then off the path by the
      // baseline shift (the normal pointing left of travel is (sin, -cos)).
      units.push({
        origin: {
          x: middle.x - (unitWidth / 2) * cos + shift * sin,
          y: middle.y - (unitWidth / 2) * sin - shift * cos,
        },
        angle: middle.angle,
        glyphs: unit.glyphs,
      });
      if (previousAngle !== undefined) {
        maxBend = Math.max(maxBend, Math.abs(angleDifference(middle.angle, previousAngle)));
      }
      previousAngle = middle.angle;
    }
    cursor += unitWidth;
  }
  return { units, startDistance, endDistance: startDistance + width, maxBend };
}

/** The signed difference between two angles, wrapped to (-π, π]. */
export function angleDifference(a: number, b: number): number {
  let difference = (a - b) % (2 * Math.PI);
  if (difference > Math.PI) difference -= 2 * Math.PI;
  if (difference <= -Math.PI) difference += 2 * Math.PI;
  return difference;
}
