import { describe, expect, it } from 'vitest';
import { notoSans, notoSansArabic } from '../testing/fonts';
import { shapeLine } from './shape';

const latin = notoSans();
const arabic = notoSansArabic();

const glyphIds = (text: string, fonts = [latin, arabic]) =>
  shapeLine(text, fonts).units.flatMap((unit) => unit.glyphs.map((glyph) => glyph.glyphId));

describe('shapeLine', () => {
  it('returns one unit per letter for Latin text, left to right', () => {
    const line = shapeLine('Market', [latin]);
    expect(line.rtl).toBe(false);
    expect(line.units.map((unit) => unit.start)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(line.advance).toBeGreaterThan(2);
    expect(line.advance).toBeCloseTo(
      line.units.reduce((sum, unit) => sum + unit.advance, 0),
      10,
    );
  });

  it('applies kerning from the font', () => {
    const together = shapeLine('AV', [latin]).advance;
    const apart = shapeLine('A', [latin]).advance + shapeLine('V', [latin]).advance;
    expect(together).toBeLessThan(apart);
  });

  it('adds tracking between units but not after the last', () => {
    const plain = shapeLine('abc', [latin]).advance;
    const tracked = shapeLine('abc', [latin], { tracking: 0.1 }).advance;
    expect(tracked - plain).toBeCloseTo(0.2, 10);
  });

  it('joins Arabic letters and lays them out right to left', () => {
    // Noto Sans Arabic draws each dot as its own glyph, so compare glyph names.
    const names = (text: string) =>
      shapeLine(text, [latin, arabic])
        .units.flatMap((unit) => unit.glyphs)
        .map((glyph) => arabic.hbFont.glyphName(glyph.glyphId))
        .filter((name) => !name.startsWith('dot'));
    expect(names('ب')).toEqual(['uni066E']); // isolated form
    // Three of the same letter: final form on the left, initial form on the right.
    expect(names('ببب')).toEqual(['uni066E.fina', 'uni066E.medi', 'uni066E.init']);
  });

  it('puts Arabic in visual order: the first word ends up on the right', () => {
    const text = 'شارع الملك'; // "King Street": two words
    const line = shapeLine(text, [latin, arabic]);
    expect(line.rtl).toBe(true);
    const words = line.units.filter((unit) => !unit.isSpace);
    expect(words).toHaveLength(2);
    // Each cursive word is one rigid unit, and the second word comes first visually.
    expect(text.slice(words[0]!.start, words[0]!.end)).toBe('الملك');
    expect(text.slice(words[1]!.start, words[1]!.end)).toBe('شارع');
  });

  it('falls back to the next font for characters the first one lacks', () => {
    const line = shapeLine('شارع', [latin, arabic]);
    const glyphs = line.units.flatMap((unit) => unit.glyphs);
    expect(glyphs.every((glyph) => glyph.fontIndex === 1)).toBe(true);
    expect(glyphs.every((glyph) => glyph.glyphId !== 0)).toBe(true);
  });

  it('draws the missing-glyph box when no font covers a character', () => {
    expect(glyphIds('ب', [latin])).toEqual([0]);
  });

  it('orders mixed-direction text visually', () => {
    const text = 'Souq سوق Road';
    const line = shapeLine(text, [latin, arabic]);
    expect(line.rtl).toBe(false);
    const drawn = line.units.filter((unit) => !unit.isSpace);
    const pieces = drawn.map((unit) => text.slice(unit.start, unit.end));
    expect(pieces.join('')).toBe('SouqسوقRoad');
    // The Arabic word is a single rigid unit drawn with the fallback font.
    const arabicUnits = drawn.filter((unit) => unit.glyphs[0]!.fontIndex === 1);
    expect(arabicUnits).toHaveLength(1);
    expect(text.slice(arabicUnits[0]!.start, arabicUnits[0]!.end)).toBe('سوق');
  });

  it('keeps a combining accent in the same unit as its base letter', () => {
    const line = shapeLine('éa', [latin]);
    expect(line.units).toHaveLength(2);
    expect(line.units[0]).toMatchObject({ start: 0, end: 2 });
  });

  it('handles empty text', () => {
    expect(shapeLine('', [latin])).toEqual({ units: [], advance: 0, rtl: false });
  });
});
