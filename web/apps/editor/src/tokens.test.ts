/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const tokensCss = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

/** The custom properties declared in the rule that starts with `selector`. */
function declared(selector: string): Record<string, string> {
  const start = tokensCss.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No rule for ${selector}`);
  const body = tokensCss.slice(tokensCss.indexOf('{', start) + 1, tokensCss.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/--nolli-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) out[name!] = value!;
  return out;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG 2 contrast ratio between two `#rrggbb` colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const light = { ...declared(':root') };
const dark = { ...light, ...declared(':root[data-theme="dark"]') };

describe('contrast', () => {
  it('computes known ratios', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });
});

describe.each([
  ['light', light],
  ['dark', dark],
] as const)('%s theme meets WCAG AA (4.5:1) for text', (_name, t) => {
  const surfaces = ['panel', 'field', 'chrome', 'accent-soft'] as const;

  it.each(['text', 'text-2', 'text-3'] as const)('%s is readable on every surface', (token) => {
    for (const surface of surfaces) {
      expect(contrast(t[token]!, t[surface]!), `${token} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('accent text is readable on the surfaces it appears on', () => {
    for (const surface of ['panel', 'field', 'accent-soft'] as const) {
      expect(contrast(t['accent']!, t[surface]!), `accent on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('text on an accent fill is readable', () => {
    expect(contrast(t['on-accent']!, t['accent']!)).toBeGreaterThanOrEqual(4.5);
  });

  it('warning text is readable on its own background', () => {
    expect(contrast(t['warn-fg']!, t['warn-bg']!)).toBeGreaterThanOrEqual(4.5);
  });

  it('destructive text is readable on the panel and a selected row', () => {
    for (const surface of ['panel', 'accent-soft'] as const) {
      expect(contrast(t['destructive']!, t[surface]!), `destructive on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
