import * as hb from 'harfbuzzjs';

/**
 * A font parsed from its file bytes. All measurements are in font units; divide
 * by `unitsPerEm` and multiply by the font size to get artwork pixels.
 */
export class LoadedFont {
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  /** @internal The HarfBuzz font, used by the shaper. */
  readonly hbFont: hb.Font;
  private readonly coverage: Set<number>;
  private readonly outlines = new Map<number, string>();

  constructor(bytes: Uint8Array | ArrayBuffer) {
    const face = new hb.Face(new hb.Blob(bytes));
    this.hbFont = new hb.Font(face);
    this.unitsPerEm = face.upem;
    const extents = this.hbFont.hExtents();
    this.ascender = extents.ascender;
    this.descender = extents.descender;
    this.coverage = new Set(face.collectUnicodes());
  }

  /** Whether the font has a glyph for this Unicode code point. */
  covers(codePoint: number): boolean {
    return this.coverage.has(codePoint);
  }

  /**
   * The glyph's outline as SVG path data, in font units with y pointing up.
   * Canvas drawing, SVG export and PDF export all start from this, which is
   * what keeps them identical.
   */
  glyphOutline(glyphId: number): string {
    let outline = this.outlines.get(glyphId);
    if (outline === undefined) {
      outline = this.hbFont.glyphToPath(glyphId);
      this.outlines.set(glyphId, outline);
    }
    return outline;
  }
}
