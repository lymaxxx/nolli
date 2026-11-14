import { apply, type Affine } from '../geometry/affine';

const COMMAND = /([MLQCZ])([^MLQCZ]*)/g;

/** A number the way the macOS exporter prints it: two decimals by default. */
export function fmt(value: number, decimals = 2): string {
  const text = value.toFixed(decimals);
  return /^-0\.?0*$/.test(text) ? text.slice(1) : text;
}

/**
 * Applies an affine transform to SVG path data made of absolute `M`, `L`, `Q`,
 * `C` and `Z` commands: the form HarfBuzz writes glyph outlines in. Anything
 * else throws, rather than producing a path that is silently wrong. `decimals`
 * trades file size for precision (one decimal is a tenth of a pixel).
 */
export function transformPathData(d: string, matrix: Affine, decimals = 2): string {
  const out: string[] = [];
  for (const [, command, rest] of d.matchAll(COMMAND)) {
    if (command === 'Z') {
      out.push('Z');
      continue;
    }
    const numbers = rest!
      .split(/[\s,]+/)
      .filter((part) => part !== '')
      .map(Number);
    const perCommand = command === 'C' ? 6 : command === 'Q' ? 4 : 2;
    if (numbers.length === 0 || numbers.length % perCommand !== 0 || numbers.some((n) => !Number.isFinite(n))) {
      throw new Error(`Cannot transform path command "${command}${rest}"`);
    }
    const points: string[] = [];
    for (let i = 0; i < numbers.length; i += 2) {
      const p = apply(matrix, { x: numbers[i]!, y: numbers[i + 1]! });
      points.push(`${fmt(p.x, decimals)} ${fmt(p.y, decimals)}`);
    }
    out.push(`${command}${points.join(' ')}`);
  }
  if (out.length === 0 && d.trim() !== '') throw new Error(`Cannot transform path data "${d.slice(0, 40)}"`);
  return out.join('');
}
