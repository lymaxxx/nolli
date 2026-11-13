import {
  multiply,
  rotation,
  scaling,
  translation,
  type Affine,
} from '../geometry/affine';
import type { Point } from '../geo/polyline';
import type { PlacedLineLabel, PlacedPointLabel } from '../layout/labels';
import type { LabelStyle } from '../model/styles';
import type { LoadedFont } from '../text/font';
import type { TextMetrics } from '../text/metrics';
import type { Rect } from './scene';

/*
 * Turns placed labels into glyphs with positions, ported from `LabelBuilder` in
 * macos/Nolli/Views/SceneRenderer.swift. Coordinates here are "local": artwork
 * space minus the scene origin, the same space the compiled scene uses.
 */

/** One glyph to draw. `matrix` maps the font's own units (y up) into local space. */
export interface GlyphInstance {
  font: LoadedFont;
  glyphId: number;
  matrix: Affine;
}

export interface LabelRun {
  glyphs: GlyphInstance[];
}

export interface LabelGeometry {
  /** Stable across redraws: layer, feature, and index within the street. */
  key: string;
  layerId: string;
  subId?: string;
  featureId: number;
  style: LabelStyle;
  /** Where the label can paint, for culling. */
  bounds: Rect;
  /** The run drawn when the label reads left to right on screen. */
  forward: LabelRun;
  /** The run drawn when the view is turned so `forward` would read upside down. */
  reverse?: LabelRun;
  /** The road's direction under the label, in radians. */
  chord: number;
  /** True for labels that stay upright whatever the view rotation (horizontal and point labels). */
  upright: boolean;
  anchor: Point;
  /** The far end of a callout line, for point labels that have one. */
  callout?: Point;
}

/**
 * Where the text baseline sits sideways from the guide line. Positive is left
 * of travel, which is visually above for left-to-right text. "On" centres the
 * glyph box on the line.
 */
export function baselineShift(style: LabelStyle, metrics: TextMetrics): number {
  switch (style.linePosition) {
    case 'above':
      return style.distanceFromLine + metrics.descent;
    case 'on':
      return -(metrics.ascent - metrics.descent) / 2;
    case 'below':
      return -(style.distanceFromLine + metrics.ascent);
  }
}

/** Glyphs following `line`, offset so the baseline lands where the line-position setting wants it. */
function curvedRun(
  line: PlacedLineLabel['line'],
  center: number,
  metrics: TextMetrics,
  style: LabelStyle,
  origin: Point,
): LabelRun {
  const shift = baselineShift(style, metrics);
  const guide = shift !== 0 ? line.offset(shift) : line;
  const onGuide = guide.length > 0 && line.length > 0 ? center * (guide.length / line.length) : center;
  const start = onGuide - metrics.width / 2;
  const minWindow = style.fontSize * 0.6;
  const glyphs: GlyphInstance[] = [];

  for (const { unit, x, advance } of metrics.units) {
    if (unit.isSpace || !(advance > 0.01)) continue;
    const mid = start + x + advance / 2;
    const p = guide.pointAt(mid);
    const half = Math.max(advance, minWindow) / 2;
    // A rigid word of a joined script is set along the chord over its own length.
    const angle = guide.chordAngle(mid - half, mid + half);
    const unitMatrix = multiply(
      translation(p.x - origin.x, p.y - origin.y),
      multiply(rotation(angle), multiply(scaling(1, -1), translation(-advance / 2, 0))),
    );
    pushUnitGlyphs(glyphs, unitMatrix, unit, metrics);
  }
  return { glyphs };
}

/** One straight line of text centred on (0, 0) in `base`'s frame. */
function straightRun(metrics: TextMetrics, baselineY: number, base: Affine): LabelRun {
  const x0 = -metrics.width / 2;
  const glyphs: GlyphInstance[] = [];
  for (const { unit, x } of metrics.units) {
    if (unit.isSpace) continue;
    const unitMatrix = multiply(base, multiply(scaling(1, -1), translation(x0 + x, baselineY)));
    pushUnitGlyphs(glyphs, unitMatrix, unit, metrics);
  }
  return { glyphs };
}

/**
 * `unitMatrix` maps a unit's own frame (pixels, y up, origin at its left end on
 * the baseline) to local space. Each glyph is offset inside it and scaled from
 * font units to pixels.
 */
function pushUnitGlyphs(
  out: GlyphInstance[],
  unitMatrix: Affine,
  unit: TextMetrics['units'][number]['unit'],
  metrics: TextMetrics,
): void {
  for (const glyph of unit.glyphs) {
    const font = metrics.fonts[glyph.fontIndex]!;
    const k = metrics.fontSize / font.unitsPerEm;
    const matrix = multiply(
      unitMatrix,
      multiply(translation(glyph.x * metrics.fontSize, glyph.y * metrics.fontSize), scaling(k, k)),
    );
    out.push({ font, glyphId: glyph.glyphId, matrix });
  }
}

function runBounds(runs: (LabelRun | undefined)[], pad: number): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const run of runs) {
    for (const glyph of run?.glyphs ?? []) {
      minX = Math.min(minX, glyph.matrix.e);
      minY = Math.min(minY, glyph.matrix.f);
      maxX = Math.max(maxX, glyph.matrix.e);
      maxY = Math.max(maxY, glyph.matrix.f);
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}

/**
 * Builds a road label at an arbitrary centre distance. The layout's own centre
 * is the normal case; a different one is used while a label is dragged along
 * its street.
 */
export function buildLineLabel(
  placed: PlacedLineLabel,
  index: number,
  center: number,
  origin: Point,
): LabelGeometry {
  const style = placed.style;
  const metrics = placed.metrics;
  const line = placed.line;
  const halfWidth = metrics.width / 2;
  const chord = line.chordAngle(center - halfWidth, center + halfWidth);
  const c = line.pointAt(center);
  const local = { x: c.x - origin.x, y: c.y - origin.y };
  const shift = baselineShift(style, metrics);

  let forward: LabelRun;
  let reverse: LabelRun | undefined;
  let upright = false;
  switch (style.lineLabelMode) {
    case 'curved':
      forward = curvedRun(line, center, metrics, style, origin);
      reverse = curvedRun(line.reversed(), line.length - center, metrics, style, origin);
      break;
    case 'parallel': {
      const at = translation(local.x, local.y);
      forward = straightRun(metrics, shift, multiply(at, rotation(chord)));
      reverse = straightRun(metrics, shift, multiply(at, rotation(chord + Math.PI)));
      break;
    }
    case 'horizontal':
      upright = true;
      forward = straightRun(metrics, shift, translation(0, 0));
      break;
  }

  const reach = halfWidth + metrics.ascent + metrics.descent + style.distanceFromLine + style.haloWidth * 2 + 4;
  const bounds: Rect =
    style.lineLabelMode === 'curved'
      ? runBounds([forward, reverse], metrics.ascent + metrics.descent + style.haloWidth + 2)
      : { x: local.x - reach, y: local.y - reach, width: reach * 2, height: reach * 2 };

  return {
    key: `${placed.layerId}|${placed.featureId}|${index}`,
    layerId: placed.layerId,
    subId: placed.subId,
    featureId: placed.featureId,
    style,
    bounds,
    forward,
    reverse,
    chord,
    upright,
    anchor: local,
  };
}

export function buildPointLabel(placed: PlacedPointLabel, origin: Point): LabelGeometry {
  const style = placed.style;
  const metrics = placed.metrics;
  const local = { x: placed.anchor.x - origin.x, y: placed.anchor.y - origin.y };
  const feature = { x: placed.featurePoint.x - origin.x, y: placed.featurePoint.y - origin.y };
  const forward = straightRun(metrics, -(metrics.ascent - metrics.descent) / 2, translation(0, 0));
  const reach = metrics.width / 2 + metrics.ascent + metrics.descent + style.haloWidth * 2 + 2;
  let bounds: Rect = { x: local.x - reach, y: local.y - reach, width: reach * 2, height: reach * 2 };

  let callout: Point | undefined;
  if (
    style.calloutsEnabled &&
    Math.hypot(local.x - feature.x, local.y - feature.y) > style.calloutMinDistance
  ) {
    callout = feature;
    const minX = Math.min(bounds.x, feature.x);
    const minY = Math.min(bounds.y, feature.y);
    const maxX = Math.max(bounds.x + bounds.width, feature.x);
    const maxY = Math.max(bounds.y + bounds.height, feature.y);
    bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  return {
    key: `${placed.layerId}|${placed.featureId}|0`,
    layerId: placed.layerId,
    featureId: placed.featureId,
    style,
    bounds,
    forward,
    chord: 0,
    upright: true,
    anchor: local,
    callout,
  };
}
