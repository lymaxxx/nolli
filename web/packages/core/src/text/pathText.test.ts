import { describe, expect, it } from 'vitest';
import { Polyline } from '../geo/polyline';
import { notoSans } from '../testing/fonts';
import { angleDifference, placeOnPath } from './pathText';
import { shapeLine } from './shape';

const latin = notoSans();

describe('placeOnPath', () => {
  it('centres text on a straight path and keeps it level', () => {
    const line = shapeLine('High Street', [latin]);
    const placed = placeOnPath(line, [{ x: 0, y: 50 }, { x: 400, y: 50 }], { fontSize: 20 });
    const width = line.advance * 20;
    expect(placed.startDistance).toBeCloseTo(200 - width / 2, 8);
    expect(placed.endDistance).toBeCloseTo(200 + width / 2, 8);
    expect(placed.maxBend).toBe(0);
    expect(placed.units[0]!.origin.x).toBeCloseTo(placed.startDistance, 8);
    for (const unit of placed.units) {
      expect(unit.angle).toBe(0);
      expect(unit.origin.y).toBeCloseTo(50, 8);
    }
    const xs = placed.units.map((unit) => unit.origin.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it('skips spaces but keeps their width', () => {
    const line = shapeLine('a b', [latin]);
    const placed = placeOnPath(line, [{ x: 0, y: 0 }, { x: 100, y: 0 }], { fontSize: 10 });
    expect(placed.units).toHaveLength(2);
    const gap = placed.units[1]!.origin.x - placed.units[0]!.origin.x;
    expect(gap).toBeCloseTo((line.units[0]!.advance + line.units[1]!.advance) * 10, 8);
  });

  it('follows a bend and reports how sharp it is', () => {
    // A right-angle corner, with the text centred on it.
    const corner = new Polyline([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
    const placed = placeOnPath(shapeLine('Corner', [latin]), corner, { fontSize: 20 });
    expect(placed.units[0]!.angle).toBe(0);
    expect(placed.units.at(-1)!.angle).toBeCloseTo(Math.PI / 2, 10);
    expect(placed.maxBend).toBeCloseTo(Math.PI / 2, 10);
  });

  it('shifts the baseline to the left of the direction of travel', () => {
    const line = shapeLine('x', [latin]);
    const east = placeOnPath(line, [{ x: 0, y: 0 }, { x: 100, y: 0 }], { fontSize: 10, baselineShift: 5 });
    expect(east.units[0]!.origin.y).toBeCloseTo(-5, 8); // up on screen
    const south = placeOnPath(line, [{ x: 0, y: 0 }, { x: 0, y: 100 }], { fontSize: 10, baselineShift: 5 });
    expect(south.units[0]!.origin.x).toBeCloseTo(5, 8);
  });
});

describe('angleDifference', () => {
  it('wraps across ±π', () => {
    expect(angleDifference(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(-0.2, 10);
    expect(angleDifference(0.3, 0.1)).toBeCloseTo(0.2, 10);
  });
});
