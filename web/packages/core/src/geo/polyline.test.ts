import { describe, expect, it } from 'vitest';
import { Polyline } from './polyline';

describe('Polyline', () => {
  const line = new Polyline([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 40 }]);

  it('measures its length', () => {
    expect(line.length).toBe(70);
    expect(line.cumulative).toEqual([0, 30, 70]);
  });

  it('samples points and tangents by distance', () => {
    expect(line.sampleAt(15)).toEqual({ x: 15, y: 0, angle: 0 });
    const down = line.sampleAt(50);
    expect(down.x).toBeCloseTo(30, 10);
    expect(down.y).toBeCloseTo(20, 10);
    expect(down.angle).toBeCloseTo(Math.PI / 2, 10);
  });

  it('continues straight past either end', () => {
    expect(line.sampleAt(-10)).toEqual({ x: -10, y: 0, angle: 0 });
    expect(line.sampleAt(80).y).toBeCloseTo(50, 10);
  });

  it('rejects a single point', () => {
    expect(() => new Polyline([{ x: 0, y: 0 }])).toThrow();
  });
});
