import type { LoadedFont, PlacedUnit } from '@nolli/core';

const outlineCache = new WeakMap<LoadedFont, Map<number, Path2D>>();

function glyphPath(font: LoadedFont, glyphId: number): Path2D {
  let cache = outlineCache.get(font);
  if (!cache) {
    cache = new Map();
    outlineCache.set(font, cache);
  }
  let path = cache.get(glyphId);
  if (!path) {
    path = new Path2D(font.glyphOutline(glyphId));
    cache.set(glyphId, path);
  }
  return path;
}

/** Fill placed text by drawing each glyph's outline, so the browser's own text engine is not involved. */
export function fillPlacedText(
  context: CanvasRenderingContext2D,
  units: readonly PlacedUnit[],
  fonts: readonly LoadedFont[],
  fontSize: number,
): void {
  for (const unit of units) {
    context.save();
    context.translate(unit.origin.x, unit.origin.y);
    context.rotate(unit.angle);
    for (const glyph of unit.glyphs) {
      const font = fonts[glyph.fontIndex]!;
      const scale = fontSize / font.unitsPerEm;
      context.save();
      context.translate(glyph.x * fontSize, -glyph.y * fontSize);
      // Font outlines have y pointing up; the canvas has y pointing down.
      context.scale(scale, -scale);
      context.fill(glyphPath(font, glyph.glyphId));
      context.restore();
    }
    context.restore();
  }
}
