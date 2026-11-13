import { describe, expect, it } from 'vitest';
import type { LayerSnapshot } from '../model/layers';
import { DEFAULT_LABEL_STYLE } from '../model/styles';
import { notoSans, notoSansArabic } from '../testing/fonts';
import { FontRegistry, fontsUsed, isItalicStyle, matchFont, weightValue } from './registry';

const regular = [notoSans(), notoSansArabic()];
const bold = [notoSans(), notoSansArabic()];
const registry = () => new FontRegistry({ regular, bold });

describe('weightValue and isItalicStyle', () => {
  it('reads the face names the macOS weight picker uses', () => {
    expect(weightValue('Regular')).toBe(400);
    expect(weightValue('Medium')).toBe(500);
    expect(weightValue('Semi Bold')).toBe(600);
    expect(weightValue('Bold Italic')).toBe(700);
    expect(weightValue('Black')).toBe(900);
    expect(weightValue('Something Else')).toBe(400);
    expect(isItalicStyle('Bold Oblique')).toBe(true);
    expect(isItalicStyle('Bold')).toBe(false);
  });
});

describe('FontRegistry', () => {
  it('falls back for a family it does not have', () => {
    const r = registry();
    expect(r.resolve('Onsite Standard TRIAL', 'Bold').match).toEqual({ kind: 'fallback' });
    expect(r.fontsFor('Onsite Standard TRIAL', 'Bold')).toBe(bold);
    expect(r.fontsFor('Onsite Standard TRIAL', 'Regular')).toBe(regular);
  });

  it('finds an exact family and face, ignoring case, and keeps the fallback behind it for other scripts', () => {
    const r = registry();
    const mine = notoSans();
    r.add('Onsite Standard TRIAL', 'Bold', mine);
    expect(r.resolve('onsite standard trial', 'bold')).toEqual({ match: { kind: 'exact' }, font: mine });
    const chain = r.fontsFor('Onsite Standard TRIAL', 'Bold');
    expect(chain[0]).toBe(mine);
    expect(chain.slice(1)).toEqual(bold);
  });

  it('uses the nearest weight of the family when the exact face is missing', () => {
    const r = registry();
    const light = notoSans();
    const heavy = notoSans();
    r.add('Fira Sans', 'Light', light);
    r.add('Fira Sans', 'Bold', heavy);
    expect(r.resolve('Fira Sans', 'Medium')).toEqual({ match: { kind: 'family', style: 'Light' }, font: light });
    expect(r.resolve('Fira Sans', 'SemiBold')).toEqual({ match: { kind: 'family', style: 'Bold' }, font: heavy });
  });

  it('prefers the requested slant when choosing the nearest face', () => {
    const r = registry();
    const upright = notoSans();
    const slanted = notoSans();
    r.add('Fira Sans', 'Regular', upright);
    r.add('Fira Sans', 'Bold Italic', slanted);
    expect(r.resolve('Fira Sans', 'Bold').font).toBe(upright);
    expect(r.resolve('Fira Sans', 'Medium Italic').font).toBe(slanted);
  });

  it('replaces a face registered twice, and forgets a removed one', () => {
    const r = registry();
    const first = notoSans();
    const second = notoSans();
    r.add('Fira Sans', 'Regular', first);
    r.add('Fira Sans', 'Regular', second);
    expect(r.resolve('Fira Sans', 'Regular').font).toBe(second);
    r.remove('Fira Sans', 'Regular');
    expect(r.resolve('Fira Sans', 'Regular').match).toEqual({ kind: 'fallback' });
  });

  it('refuses to exist without fallback fonts', () => {
    expect(() => new FontRegistry({ regular: [], bold })).toThrow();
  });
});

describe('matchFont', () => {
  const available = [
    { family: 'Fira Sans', style: 'Light' },
    { family: 'Fira Sans', style: 'Bold' },
  ];
  it('reports exact, nearest-face and fallback matches from names alone', () => {
    expect(matchFont(available, { family: 'fira sans', style: 'bold' })).toEqual({ kind: 'exact' });
    expect(matchFont(available, { family: 'Fira Sans', style: 'Medium' })).toEqual({ kind: 'family', style: 'Light' });
    expect(matchFont(available, { family: 'Helvetica Neue', style: 'Bold' })).toEqual({ kind: 'fallback' });
    expect(matchFont([], { family: 'Fira Sans', style: 'Bold' })).toEqual({ kind: 'fallback' });
  });
});

describe('fontsUsed', () => {
  const layer = (over: Partial<LayerSnapshot>): LayerSnapshot => ({ ...({} as LayerSnapshot), roadSubLayers: [], ...over });
  const style = (fontName: string, fontWeight: string, enabled = true) => ({
    ...DEFAULT_LABEL_STYLE,
    enabled,
    fontName,
    fontWeight,
  });

  it('lists each font and face once, only where labels are switched on', () => {
    const layers = [
      layer({
        labelStyle: style('Helvetica Neue', 'Regular'),
        roadSubLayers: [
          { labelStyle: style('Helvetica Neue', 'Bold') },
          { labelStyle: style('helvetica neue', 'bold') },
          { labelStyle: style('Fira Sans', 'Medium', false) },
        ] as LayerSnapshot['roadSubLayers'],
      }),
      layer({ labelStyle: style('Onsite Standard TRIAL', 'Regular') }),
      layer({ labelStyle: style('Hidden', 'Regular', false) }),
    ];
    expect(fontsUsed(layers)).toEqual([
      { family: 'Helvetica Neue', style: 'Regular' },
      { family: 'Helvetica Neue', style: 'Bold' },
      { family: 'Onsite Standard TRIAL', style: 'Regular' },
    ]);
  });
});
