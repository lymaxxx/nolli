import type { LoadedFont } from './font';
import { shapeLine, type ShapedLine, type ShapedUnit } from './shape';

/** Where fonts come from. The core never loads fonts itself; the app supplies them. */
export interface FontProvider {
  /**
   * The fallback chain for a font family and weight, best match first. It must
   * return at least one font; a name the app cannot find should resolve to a
   * default rather than nothing.
   */
  fontsFor(fontName: string, fontWeight: string): readonly LoadedFont[];
}

/** One unit of shaped text with its position along the line, in artwork pixels. */
export interface MetricUnit {
  unit: ShapedUnit;
  /** Distance from the line's left end to this unit's leading edge. */
  x: number;
  /** The unit's width, including any tracking after it. */
  advance: number;
}

/**
 * The measured size of one line of text at a font size, in artwork pixels.
 * The counterpart of `TextMetrics` in `LabelRendering.swift`, built on HarfBuzz
 * instead of CoreText.
 */
export interface TextMetrics {
  line: ShapedLine;
  fonts: readonly LoadedFont[];
  fontSize: number;
  /** Width without the tracking after the last unit, so centring does not drift. */
  width: number;
  /** Distance from the baseline to the top of the tallest font used, positive. */
  ascent: number;
  /** Distance from the baseline to the bottom of the lowest font used, positive. */
  descent: number;
  units: readonly MetricUnit[];
}

export interface MeasureStyle {
  fontName: string;
  fontWeight: string;
  fontSize: number;
  /** Thousandths of an em, as stored in project files. */
  tracking: number;
  /** Thousandths of an em, added after each space. */
  wordSpacing: number;
}

const MAX_CACHED = 20_000;

/** Measures text, remembering results so layout does not reshape the same name twice. */
export class TextMeasurer {
  private readonly cache = new Map<string, TextMetrics>();

  constructor(private readonly provider: FontProvider) {}

  measure(text: string, style: MeasureStyle): TextMetrics {
    const key = [text, style.fontName, style.fontWeight, style.fontSize, style.tracking, style.wordSpacing].join(
      '|',
    );
    const hit = this.cache.get(key);
    if (hit) return hit;

    const fonts = this.provider.fontsFor(style.fontName, style.fontWeight);
    const line = shapeLine(text, fonts, {
      tracking: style.tracking / 1000,
      wordSpacing: style.wordSpacing / 1000,
    });

    const units: MetricUnit[] = [];
    let x = 0;
    for (const unit of line.units) {
      const advance = unit.advance * style.fontSize;
      units.push({ unit, x, advance });
      x += advance;
    }

    let ascent = 0;
    let descent = 0;
    const used = new Set<number>(line.units.flatMap((unit) => unit.glyphs.map((glyph) => glyph.fontIndex)));
    if (used.size === 0) used.add(0);
    for (const index of used) {
      const font = fonts[index]!;
      ascent = Math.max(ascent, (Math.abs(font.ascender) / font.unitsPerEm) * style.fontSize);
      descent = Math.max(descent, (Math.abs(font.descender) / font.unitsPerEm) * style.fontSize);
    }

    const metrics: TextMetrics = {
      line,
      fonts,
      fontSize: style.fontSize,
      width: Math.max(line.advance * style.fontSize, 0),
      ascent,
      descent,
      units,
    };
    if (this.cache.size > MAX_CACHED) this.cache.clear();
    this.cache.set(key, metrics);
    return metrics;
  }
}
