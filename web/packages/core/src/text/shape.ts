import bidiFactory from 'bidi-js';
import * as hb from 'harfbuzzjs';
import type { LoadedFont } from './font';

const bidi = bidiFactory();

/** One positioned glyph. Coordinates are in ems, relative to its unit's left edge on the baseline. */
export interface ShapedGlyph {
  glyphId: number;
  /** Index into the font chain passed to `shapeLine`. */
  fontIndex: number;
  /** Horizontal position in ems, y up. */
  x: number;
  y: number;
}

/**
 * The smallest piece of a line that may be moved or rotated on its own when the
 * text follows a path. For most scripts this is one cluster (a base letter with
 * its marks, or a ligature). For cursive scripts such as Arabic it is a whole
 * word, because rotating letters separately would break the joins between them.
 */
export interface ShapedUnit {
  glyphs: ShapedGlyph[];
  /** Width in ems. */
  advance: number;
  /** UTF-16 range of the source text this unit covers: `[start, end)`. */
  start: number;
  end: number;
  /** True when the unit holds only white space (nothing to draw). */
  isSpace: boolean;
  /**
   * True for a whole word of a joined script. It moves as one piece, so it
   * cannot follow a bend inside its own length the way separate letters can.
   */
  rigid: boolean;
}

/** A shaped line: units in visual order, left to right, whatever the scripts' directions. */
export interface ShapedLine {
  units: ShapedUnit[];
  /** Total width in ems, including tracking and word spacing. */
  advance: number;
  /** True when the line's base direction is right to left. */
  rtl: boolean;
}

export interface ShapeOptions {
  /** Extra space after each unit, in ems. Not applied inside cursive words. */
  tracking?: number;
  /** Extra space added to each white-space unit, in ems. */
  wordSpacing?: number;
}

/** A stretch of text with one direction and one font. */
interface Run {
  start: number;
  end: number;
  level: number;
  fontIndex: number;
}

/**
 * Shape one line of text.
 *
 * `fonts` is a fallback chain: each character uses the first font that has a
 * glyph for it, so a Latin display face can be backed by, say, Noto Sans Arabic.
 * Characters no font covers use the first font and draw its "missing glyph" box.
 *
 * Mixed-direction text is handled with the Unicode bidirectional algorithm: the
 * line is split into runs, each run is shaped by HarfBuzz, and the runs are then
 * put into visual order.
 */
export function shapeLine(
  text: string,
  fonts: readonly LoadedFont[],
  options: ShapeOptions = {},
): ShapedLine {
  if (fonts.length === 0) throw new Error('shapeLine needs at least one font');
  const tracking = options.tracking ?? 0;
  const wordSpacing = options.wordSpacing ?? 0;
  if (text.length === 0) return { units: [], advance: 0, rtl: false };

  const embedding = bidi.getEmbeddingLevels(text, 'auto');
  const baseLevel = embedding.paragraphs[0]?.level ?? 0;
  const runs = visualOrder(splitRuns(text, embedding.levels, fonts));

  const units: ShapedUnit[] = [];
  for (const run of runs) {
    units.push(...shapeRun(text, run, fonts[run.fontIndex]!));
  }

  let advance = 0;
  units.forEach((unit, index) => {
    if (unit.isSpace) unit.advance += wordSpacing;
    // Tracking goes between units, not after the last one.
    if (index < units.length - 1) unit.advance += tracking;
    advance += unit.advance;
  });
  return { units, advance, rtl: (baseLevel & 1) === 1 };
}

/** Split the text wherever the direction level or the chosen font changes. */
function splitRuns(text: string, levels: Uint8Array, fonts: readonly LoadedFont[]): Run[] {
  const runs: Run[] = [];
  let previousFont = 0;
  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index)!;
    const size = codePoint > 0xffff ? 2 : 1;
    const level = levels[index] ?? 0;
    const fontIndex = chooseFont(codePoint, fonts, previousFont);
    previousFont = fontIndex;
    const last = runs[runs.length - 1];
    if (last && last.level === level && last.fontIndex === fontIndex) {
      last.end = index + size;
    } else {
      runs.push({ start: index, end: index + size, level, fontIndex });
    }
    index += size;
  }
  return runs;
}

function chooseFont(codePoint: number, fonts: readonly LoadedFont[], previous: number): number {
  // Spaces, marks and joiners stay with the font of the text before them, so a
  // fallback font is never switched in for a single space or combining accent.
  if (isNeutralForFontChoice(codePoint) && fonts[previous]!.covers(codePoint)) return previous;
  if (isInvisibleFormatting(codePoint)) return previous;
  const found = fonts.findIndex((font) => font.covers(codePoint));
  return found === -1 ? 0 : found;
}

function isNeutralForFontChoice(codePoint: number): boolean {
  return /[\s\p{M}\p{P}\p{N}]/u.test(String.fromCodePoint(codePoint));
}

/** Zero-width joiners and direction marks: no glyph is needed for them. */
function isInvisibleFormatting(codePoint: number): boolean {
  return /\p{Cf}/u.test(String.fromCodePoint(codePoint));
}

/** Reorder runs from logical to visual order (rule L2 of the bidirectional algorithm). */
function visualOrder(runs: Run[]): Run[] {
  const ordered = runs.slice();
  const highest = Math.max(0, ...ordered.map((run) => run.level));
  const lowestOdd = Math.min(...ordered.filter((run) => run.level & 1).map((run) => run.level));
  if (!Number.isFinite(lowestOdd)) return ordered;
  for (let level = highest; level >= lowestOdd; level--) {
    for (let start = 0; start < ordered.length; ) {
      if (ordered[start]!.level < level) {
        start++;
        continue;
      }
      let end = start;
      while (end < ordered.length && ordered[end]!.level >= level) end++;
      reverseRange(ordered, start, end);
      start = end;
    }
  }
  return ordered;
}

function reverseRange<T>(items: T[], start: number, end: number): void {
  for (let i = start, j = end - 1; i < j; i++, j--) {
    const swap = items[i]!;
    items[i] = items[j]!;
    items[j] = swap;
  }
}

/** Shape one run and group its glyphs into units, in visual order. */
function shapeRun(text: string, run: Run, font: LoadedFont): ShapedUnit[] {
  const rtl = (run.level & 1) === 1;
  const buffer = new hb.Buffer();
  // The whole string is given as context so letters at the run's edges still
  // join correctly with their neighbours; cluster values are UTF-16 indices.
  buffer.addText(text, run.start, run.end - run.start);
  buffer.guessSegmentProperties();
  buffer.setDirection(rtl ? hb.Direction.RTL : hb.Direction.LTR);
  hb.shape(font.hbFont, buffer);

  const infos = buffer.getGlyphInfos();
  const positions = buffer.getGlyphPositions();
  const em = font.unitsPerEm;

  // Words in a cursive script move as one piece. Because tracking is added
  // between units, this also keeps it from pulling the joins apart.
  const cursive = isCursive(text.slice(run.start, run.end));

  // Cluster boundaries in the source text, so each unit knows what it covers.
  const clusterStarts = [...new Set(infos.map((info) => info.cluster))].sort((a, b) => a - b);
  const clusterEnd = (cluster: number): number => {
    const next = clusterStarts[clusterStarts.indexOf(cluster) + 1];
    return next ?? run.end;
  };

  const units: ShapedUnit[] = [];
  let current: ShapedUnit | undefined;
  let currentCluster = -1;
  for (let i = 0; i < infos.length; i++) {
    const info = infos[i]!;
    const position = positions[i]!;
    const start = info.cluster;
    const end = clusterEnd(info.cluster);
    const isSpace = text.slice(start, end).trim().length === 0;

    const sameCluster = current !== undefined && info.cluster === currentCluster;
    const sameWord = cursive && current !== undefined && !current.isSpace && !isSpace;
    if (!current || !(sameCluster || sameWord)) {
      current = { glyphs: [], advance: 0, start, end, isSpace, rigid: cursive && !isSpace };
      units.push(current);
    }
    currentCluster = info.cluster;
    current.start = Math.min(current.start, start);
    current.end = Math.max(current.end, end);
    current.glyphs.push({
      glyphId: info.codepoint,
      fontIndex: run.fontIndex,
      x: current.advance + position.xOffset / em,
      y: position.yOffset / em,
    });
    current.advance += position.xAdvance / em;
  }
  return units;
}

/** Scripts whose letters join, so a word must stay rigid on a curved path. */
function isCursive(text: string): boolean {
  return /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Nko}\p{Script=Mongolian}\p{Script=Mandaic}]/u.test(
    text,
  );
}
