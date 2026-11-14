import { describe, expect, it } from 'vitest';
import {
  applyColorScheme,
  captureColorScheme,
  cmykToRgb,
  colorToHex,
  hexToColor,
  hsbToRgb,
  paletteSample,
  rgbToCmyk,
  rgbToHsb,
  sameColor,
} from './color';
import { loadProject } from '../project/project';
import { readFileSync } from 'node:fs';

const currentJSON = readFileSync(
  new URL('../project/fixtures/macos-v7.json', import.meta.url),
  'utf8',
);

describe('colour conversions', () => {
  it('formats and parses 6-digit and 3-digit hex strings', () => {
    const red = hexToColor('#ff3300', 0.8);
    expect(red).not.toBeNull();
    expect(colorToHex(red!)).toBe('FF3300');
    expect(red!.a).toBeCloseTo(0.8, 5);

    const short = hexToColor('0aF');
    expect(short).not.toBeNull();
    expect(colorToHex(short!)).toBe('00AAFF');
    expect(hexToColor('not-a-hex')).toBeNull();
  });

  it('round-trips RGB through HSB and CMYK', () => {
    const original = { r: 0.25, g: 0.55, b: 0.85, a: 0.9 };
    const hsb = rgbToHsb(original);
    const fromHsb = hsbToRgb(hsb.h, hsb.s, hsb.b, original.a);
    expect(sameColor(original, fromHsb)).toBe(true);

    const cmyk = rgbToCmyk(original);
    const fromCmyk = cmykToRgb(cmyk.c, cmyk.m, cmyk.y, cmyk.k, original.a);
    expect(sameColor(original, fromCmyk)).toBe(true);

    expect(rgbToCmyk({ r: 0, g: 0, b: 0, a: 1 })).toEqual({ c: 0, m: 0, y: 0, k: 1 });
  });

  it('captures and re-applies a whole-map colour scheme', () => {
    const project = loadProject(currentJSON);
    const captured = captureColorScheme(project, 'Warm test', '00000000-0000-4000-8000-000000000099');
    expect(captured.name).toBe('Warm test');
    expect(paletteSample(captured).length).toBeGreaterThan(0);

    const modified = {
      ...project,
      artboardBackground: { r: 0, g: 0, b: 0, a: 1 },
      layers: project.layers.map((layer) => ({
        ...layer,
        roadStyle: { ...layer.roadStyle, color: { r: 1, g: 0, b: 0, a: 1 } },
      })),
    };
    const restored = applyColorScheme(modified, captured);
    expect(restored.layers[0]!.roadStyle.color).toEqual(project.layers[0]!.roadStyle.color);
    expect(restored.artboardBackground).toEqual(project.artboardBackground);
  });
});
