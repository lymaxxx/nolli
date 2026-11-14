import { describe, expect, it } from 'vitest';
import { IDENTITY, rotation, scaling, translation, multiply } from '../geometry/affine';
import { fmt, transformPathData } from './pathData';

describe('fmt', () => {
  it('prints two decimals and never "-0.00"', () => {
    expect(fmt(1.005)).toBe('1.00');
    expect(fmt(12.346)).toBe('12.35');
    expect(fmt(-0.001)).toBe('0.00');
    expect(fmt(-2)).toBe('-2.00');
    expect(fmt(-0.04, 1)).toBe('0.0');
    expect(fmt(3.14159, 1)).toBe('3.1');
  });
});

describe('transformPathData', () => {
  const outline = 'M545,0L459,221L176,221ZM352,517Q349,525 342,546Q335,567 328.5,589.5Z';

  it('leaves the shape alone under the identity', () => {
    expect(transformPathData(outline, IDENTITY)).toBe(
      'M545.00 0.00L459.00 221.00L176.00 221.00ZM352.00 517.00Q349.00 525.00 342.00 546.00Q335.00 567.00 328.50 589.50Z',
    );
  });

  it('applies scale, flip and translation to every coordinate, control points included', () => {
    // Font units (y up) to screen: scale by 0.1, flip y, move to (100, 50).
    const matrix = multiply(translation(100, 50), scaling(0.1, -0.1));
    expect(transformPathData('M10,20L30,40Q50,60 70,80C1,2 3,4 5,6Z', matrix)).toBe(
      'M101.00 48.00L103.00 46.00Q105.00 44.00 107.00 42.00C100.10 49.80 100.30 49.60 100.50 49.40Z',
    );
  });

  it('can print fewer decimals to keep files small', () => {
    expect(transformPathData('M10.26,20.74Z', IDENTITY, 1)).toBe('M10.3 20.7Z');
  });

  it('rotates', () => {
    const quarterTurn = rotation(Math.PI / 2);
    expect(transformPathData('M10,0L0,10Z', quarterTurn)).toBe('M0.00 10.00L-10.00 0.00Z');
  });

  it('handles an empty outline (a space) and refuses commands it does not understand', () => {
    expect(transformPathData('', IDENTITY)).toBe('');
    expect(() => transformPathData('M0,0H10', IDENTITY)).toThrow();
    expect(() => transformPathData('M0,0L10', IDENTITY)).toThrow(/Cannot transform/);
  });
});
