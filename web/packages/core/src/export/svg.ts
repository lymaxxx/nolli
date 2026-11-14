import { multiply, rotation, translation, type Affine } from '../geometry/affine';
import { Polyline, type Point } from '../geo/polyline';
import type {
  PlacedLineLabel,
  PlacedPointLabel,
  MapLabelLayout,
} from '../layout/labels';
import type { LayerSnapshot, RoadSubLayer } from '../model/layers';
import type { ProjectSnapshot } from '../model/project';
import type { CodableColor, LabelStyle, RoadStyle } from '../model/styles';
import {
  projectionOf,
  screenTransform,
  toScreen,
  toScreenWorld,
  type Projection,
} from '../projection/projection';
import { baselineShift, buildLineLabel, buildPointLabel, type LabelGeometry } from '../render/labelGeometry';
import { featureKind } from '../render/scene';
import type { TextMeasurer } from '../text/metrics';
import { fmt, transformPathData } from './pathData';

/*
 * SVG export, ported from `SVGExporter` in macos/Nolli/Services/SVGExporter.swift.
 * It uses the same projection and the same label layout as the screen, so the
 * file looks like the map. Group ids follow the macOS file so a designer's
 * scripts and layer habits carry over.
 */

export interface SvgExportOptions {
  widthMM: number;
  heightMM: number;
  dpi: number;
  /**
   * How labels are written.
   *
   * - `outlines`: every label is one `<path>` of glyph outlines. It looks the
   *   same on every machine and for every script, but is no longer editable text.
   * - `live`: labels are `<text>` (curved ones are `<text><textPath>`), as the
   *   macOS app writes them. They are editable, but show the font the viewer
   *   has, so they need the project's fonts installed, and Illustrator
   *   flattens `textPath` on import.
   */
  text: 'outlines' | 'live';
  /** Adds a comment holding the geographic bounds. */
  embedBBoxMeta?: boolean;
}

/** Pixel size of the export for a physical size and resolution. */
export function exportPixelSize(options: Pick<SvgExportOptions, 'widthMM' | 'heightMM' | 'dpi'>): {
  width: number;
  height: number;
} {
  return {
    width: (options.widthMM * options.dpi) / 25.4,
    height: (options.heightMM * options.dpi) / 25.4,
  };
}

/**
 * The artboard height, in millimetres, that frames the project's area exactly
 * at the given width: the area's height-to-width ratio in Web Mercator, which
 * is what the exporter's projection uses. This is "Fit to Area".
 */
export function fitHeightToArea(
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number },
  widthMM: number,
): number {
  const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const width = ((bbox.maxLon - bbox.minLon) * Math.PI) / 180;
  const height = mercatorY(bbox.maxLat) - mercatorY(bbox.minLat);
  return width > 0 ? (widthMM * height) / width : widthMM;
}

/** The projection the exporter draws through: the project's area fitted to the artboard width. */
export function exportProjection(
  project: ProjectSnapshot,
  options: Pick<SvgExportOptions, 'widthMM' | 'heightMM' | 'dpi'>,
): { projection: Projection; scale: number } {
  const bbox = project.boundingBox;
  if (!bbox) throw new Error('The project has no area to export. Set one first.');
  const { width, height } = exportPixelSize(options);
  // The zoom that makes the area span exactly the artboard width, so the artwork
  // is a uniform scale of the base-zoom design.
  const fractionWidth = Math.max((bbox.maxLon - bbox.minLon) / 360, 1e-12);
  const zoom = Math.log2(width / (256 * fractionWidth));
  const projection = projectionOf(
    {
      centerLat: (bbox.minLat + bbox.maxLat) / 2,
      centerLon: (bbox.minLon + bbox.maxLon) / 2,
      zoom,
      rotation: project.artboardRotation,
    },
    { width, height },
  );
  return { projection, scale: 2 ** (zoom - project.baseZoom) };
}

/** `#RRGGBB` the way the macOS app writes it: each channel truncated, not rounded. */
function hex(color: CodableColor): string {
  const byte = (v: number) => Math.trunc(Math.max(0, Math.min(1, v)) * 255).toString(16).toUpperCase().padStart(2, '0');
  return `#${byte(color.r)}${byte(color.g)}${byte(color.b)}`;
}

function sanitizeId(text: string): string {
  return Array.from(text, (c) => (/[\p{L}\p{N}_-]/u.test(c) ? c : '-')).join('');
}

function xmlEscape(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function pathD(points: readonly Point[]): string {
  if (points.length < 2) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${fmt(p.x)} ${fmt(p.y)}`).join(' ');
}

function resolvedLineStyle(master: RoadStyle, sub: RoadSubLayer): RoadStyle {
  if (sub.lineOverrides !== undefined && sub.lineOverrides !== null) return sub.customStyle;
  return sub.useCustomStyle ? sub.customStyle : master;
}

function cssWeight(name: string): number {
  switch (name.toLowerCase()) {
    case 'ultralight':
    case 'ultra light':
    case 'extralight':
    case 'extra light':
      return 200;
    case 'thin':
      return 100;
    case 'light':
      return 300;
    case 'medium':
      return 500;
    case 'semibold':
    case 'semi bold':
    case 'demibold':
    case 'demi':
      return 600;
    case 'bold':
      return 700;
    case 'heavy':
    case 'extrabold':
    case 'extra bold':
      return 800;
    case 'black':
      return 900;
    default:
      return 400;
  }
}

/** Writes the project as an SVG document. `layout` must be the layout of the same project. */
export function exportSVG(
  project: ProjectSnapshot,
  layout: MapLabelLayout,
  measurer: TextMeasurer,
  options: SvgExportOptions,
): string {
  const { projection, scale } = exportProjection(project, options);
  const { width, height } = projection.viewport;
  const baseZoom = project.baseZoom;
  const bbox = project.boundingBox!;
  const defs: string[] = [];
  let guideCount = 0;

  const toScreenPoint = (world: Point): Point => toScreenWorld(projection, world, baseZoom);

  // ── Geometry ──────────────────────────────────────────────────────────────
  const lineGroup = (layer: LayerSnapshot): string => {
    let out = '';
    const emit = (features: LayerSnapshot['lineFeatures'], style: RoadStyle, subId: string) => {
      if (features.length === 0) return;
      const ids: string[] = [];
      for (const feature of features) {
        const d = pathD(feature.coordinates.map((c) => toScreen(projection, c[1]!, c[0]!)));
        if (d === '') continue;
        const id = sanitizeId(`p${feature.id}${subId.slice(-4)}`);
        defs.push(`  <path id="${id}" d="${d}" fill="none"/>\n`);
        ids.push(id);
      }
      let inner = '';
      if (style.casingEnabled && style.casingWidth > 0) {
        for (const id of ids) {
          inner += `  <use href="#${id}" stroke="${hex(style.casingColor)}" stroke-width="${fmt(style.casingWidth * scale)}" stroke-linecap="${style.lineCap}" stroke-linejoin="${style.lineJoin}" fill="none"/>\n`;
        }
      }
      for (const id of ids) {
        inner += `  <use href="#${id}" stroke="${hex(style.color)}" stroke-width="${fmt(style.width * scale)}" stroke-linecap="${style.lineCap}" stroke-linejoin="${style.lineJoin}" fill="none" opacity="${fmt(style.color.a * style.opacity)}"/>\n`;
      }
      out += `<g id="${sanitizeId(subId)}">\n${inner}</g>\n`;
    };

    if (layer.kind === 'roads') {
      // The top road type draws last, so it lands on top, as on screen.
      for (const sub of [...layer.roadSubLayers].reverse()) {
        if (!sub.isVisible) continue;
        const types = new Set(sub.roadTypes);
        const features = layer.lineFeatures.filter((f) => {
          const highway = Object.hasOwn(f.tags, 'highway') ? f.tags['highway'] : undefined;
          return highway !== undefined && types.has(highway);
        });
        emit(features, resolvedLineStyle(layer.roadStyle, sub), `roads-${sub.name.toLowerCase()}-${sub.id.slice(0, 6)}`);
      }
    } else {
      emit(layer.lineFeatures, layer.roadStyle, `lines-${layer.id.slice(0, 6)}`);
    }
    return out;
  };

  const polygonGroup = (layer: LayerSnapshot): string => {
    const style = layer.areaStyle;
    let out = '';
    for (const feature of layer.polygonFeatures) {
      if (!feature.rings[0] || feature.rings[0].length === 0) continue;
      let d = '';
      for (const ring of feature.rings) {
        const points = ring.map((c) => toScreen(projection, c[1]!, c[0]!));
        if (points.length < 3) continue;
        d += `${pathD(points)} Z `;
      }
      if (d === '') continue;
      const stroke =
        style.strokeEnabled && style.strokeWidth > 0
          ? `stroke="${hex(style.strokeColor)}" stroke-width="${fmt(style.strokeWidth * scale)}"`
          : 'stroke="none"';
      out += `  <path d="${d}" fill="${hex(style.fillColor)}" fill-opacity="${fmt(style.fillColor.a * style.fillOpacity)}" ${stroke} fill-rule="evenodd"/>\n`;
    }
    // Unclosed ways in area layers (rivers, canals) draw as lines, as on screen.
    for (const feature of layer.lineFeatures) {
      const d = pathD(feature.coordinates.map((c) => toScreen(projection, c[1]!, c[0]!)));
      if (d === '') continue;
      out += `  <path d="${d}" fill="none" stroke="${hex(style.fillColor)}" stroke-opacity="${fmt(style.fillColor.a * style.fillOpacity)}" stroke-width="${fmt(Math.max(style.strokeWidth, 2) * scale)}" stroke-linejoin="round" stroke-linecap="round"/>\n`;
    }
    return out;
  };

  const pointGroup = (layer: LayerSnapshot): string => {
    const style = layer.poiStyle;
    const r = (style.size / 2) * scale;
    let out = '';
    for (const feature of layer.pointFeatures) {
      if (feature.coordinate.length < 2) continue;
      const p = toScreen(projection, feature.coordinate[1]!, feature.coordinate[0]!);
      const common = `fill="${hex(style.fillColor)}" stroke="${hex(style.strokeColor)}" stroke-width="${fmt(style.strokeWidth * scale)}"`;
      if (style.shape === 'circle') {
        out += `  <circle cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="${fmt(r)}" ${common}/>\n`;
      } else if (style.shape === 'square') {
        out += `  <rect x="${fmt(p.x - r)}" y="${fmt(p.y - r)}" width="${fmt(r * 2)}" height="${fmt(r * 2)}" ${common}/>\n`;
      } else {
        const d = `M ${fmt(p.x)} ${fmt(p.y - r)} L ${fmt(p.x + r)} ${fmt(p.y)} L ${fmt(p.x)} ${fmt(p.y + r)} L ${fmt(p.x - r)} ${fmt(p.y)} Z`;
        out += `  <path d="${d}" ${common}/>\n`;
      }
    }
    return out;
  };

  const layerGroup = (layer: LayerSnapshot): string => {
    const id = sanitizeId(`layer-${layer.kind}-${layer.id.slice(0, 8)}`);
    const kind = featureKind(layer.kind);
    const inner = kind === 'line' ? lineGroup(layer) : kind === 'polygon' ? polygonGroup(layer) : pointGroup(layer);
    return inner === '' ? '' : `<g id="${id}">\n${inner}</g>\n`;
  };

  const iconGroup = (layer: LayerSnapshot): string => {
    const symbol = layer.symbolStyle;
    if (!symbol.enabled || !symbol.isVisible) return '';
    const data =
      symbol.inlineSVGData ?? project.iconLibrary.find((icon) => icon.id === symbol.iconId)?.svgData ?? undefined;
    if (!data) return '';
    const w = symbol.width * scale;
    const h = symbol.height * scale;
    if (!(w > 0) || !(h > 0)) return '';
    let out = '';
    for (const icon of layout.icons) {
      if (icon.layerId !== layer.id) continue;
      const p = toScreenPoint(icon.point);
      let transform = `translate(${fmt(p.x)} ${fmt(p.y)})`;
      if (symbol.rotation !== 0) transform += ` rotate(${fmt(symbol.rotation)})`;
      out += `  <image href="data:image/svg+xml;base64,${data}" x="${fmt(-w / 2)}" y="${fmt(-h / 2)}" width="${fmt(w)}" height="${fmt(h)}" opacity="${fmt(symbol.opacity)}" transform="${transform}"/>\n`;
    }
    return out;
  };

  // ── Labels ────────────────────────────────────────────────────────────────
  /** Local-to-screen transform for label geometry built with a zero origin. */
  const worldToScreen: Affine = screenTransform(projection, baseZoom);
  const viewRotation = (projection.rotation * Math.PI) / 180;
  const zero: Point = { x: 0, y: 0 };

  const paintAttrs = (style: LabelStyle): string => {
    let attrs = `fill="${hex(style.color)}"`;
    const fillOpacity = style.color.a * style.opacity;
    if (fillOpacity < 1) attrs += ` fill-opacity="${fmt(fillOpacity)}"`;
    if (style.bufferEnabled && style.haloWidth > 0) {
      attrs += ` stroke="${hex(style.haloColor)}" stroke-width="${fmt(style.haloWidth * 2 * scale)}"`;
      const strokeOpacity = style.haloColor.a * style.bufferOpacity;
      if (strokeOpacity < 1) attrs += ` stroke-opacity="${fmt(strokeOpacity)}"`;
      attrs += ' stroke-linejoin="round" stroke-linecap="round" paint-order="stroke"';
    }
    return attrs;
  };

  const outlined = (geometry: LabelGeometry, text: string): string => {
    let run = geometry.forward;
    let prefix: Affine = worldToScreen;
    if (geometry.upright) {
      // Upright labels are drawn around their anchor and counter-rotate the view.
      prefix = multiply(worldToScreen, multiply(translation(geometry.anchor.x, geometry.anchor.y), rotation(viewRotation)));
    } else if (Math.cos(geometry.chord - viewRotation) < 0) {
      run = geometry.reverse ?? geometry.forward;
    }
    let d = '';
    for (const glyph of run.glyphs) {
      const outline = glyph.font.glyphOutline(glyph.glyphId);
      if (outline === '') continue;
      d += transformPathData(outline, multiply(prefix, glyph.matrix), 1);
    }
    if (d === '') return '';
    return `    <path d="${d}" ${paintAttrs(geometry.style)}><title>${xmlEscape(text)}</title></path>\n`;
  };

  const textAttrs = (style: LabelStyle): string => {
    const fontSize = style.fontSize * scale;
    const letterSpacing = (style.tracking / 1000) * fontSize;
    let attrs = `font-family="${xmlEscape(style.fontName)}, Helvetica, sans-serif"`;
    const weight = cssWeight(style.fontWeight);
    if (weight !== 400) attrs += ` font-weight="${weight}"`;
    attrs += ` font-size="${fmt(fontSize)}" fill="${hex(style.color)}"`;
    const fillOpacity = style.color.a * style.opacity;
    if (fillOpacity < 1) attrs += ` fill-opacity="${fmt(fillOpacity)}"`;
    if (letterSpacing !== 0) attrs += ` letter-spacing="${fmt(letterSpacing)}"`;
    if (style.wordSpacing !== 0) attrs += ` word-spacing="${fmt((style.wordSpacing / 1000) * fontSize)}"`;
    if (style.bufferEnabled && style.haloWidth > 0) {
      attrs += ` stroke="${hex(style.haloColor)}" stroke-width="${fmt(style.haloWidth * 2 * scale)}"`;
      const strokeOpacity = style.haloColor.a * style.bufferOpacity;
      if (strokeOpacity < 1) attrs += ` stroke-opacity="${fmt(strokeOpacity)}"`;
      attrs += ' stroke-linejoin="round" stroke-linecap="round" paint-order="stroke"';
    }
    return attrs;
  };

  const scaledMetrics = (text: string, style: LabelStyle) =>
    measurer.measure(text, { ...style, fontSize: style.fontSize * scale });

  const liveLine = (label: PlacedLineLabel): string => {
    const style = label.style;
    const screenPoints = label.line.points.map(toScreenPoint);
    let line = Polyline.tryCreate(screenPoints);
    if (!line || !(line.length > 1) || !(label.line.length > 0)) return '';

    let center = line.length * (label.centerDist / label.line.length);
    const metrics = scaledMetrics(label.text, style);
    const halfWidth = metrics.width / 2;
    const chord = line.chordAngle(center - halfWidth, center + halfWidth);
    if (Math.cos(chord) < 0) {
      line = line.reversed();
      center = line.length - center;
    }
    const shift = baselineShift({ ...style, distanceFromLine: style.distanceFromLine * scale }, metrics);
    const dir = /[֐-ࣿ]/.test(label.text) ? ' direction="rtl"' : '';

    if (style.lineLabelMode === 'curved') {
      const guide = shift !== 0 ? line.offset(shift) : line;
      const centerOnGuide = guide.length > 0 ? center * (guide.length / line.length) : center;
      const startOffset = Math.max(centerOnGuide - halfWidth, 0);
      guideCount += 1;
      const id = `lblguide${guideCount}`;
      defs.push(`  <path id="${id}" d="${pathD(guide.points)}" fill="none"/>\n`);
      return `    <text ${textAttrs(style)}${dir}><textPath href="#${id}" xlink:href="#${id}" startOffset="${fmt(startOffset)}">${xmlEscape(label.text)}</textPath></text>\n`;
    }

    const p = line.pointAt(center);
    const angle = style.lineLabelMode === 'parallel' ? (line.chordAngle(center - halfWidth, center + halfWidth) * 180) / Math.PI : 0;
    let transform = `translate(${fmt(p.x)} ${fmt(p.y)})`;
    if (angle !== 0) transform += ` rotate(${fmt(angle)})`;
    return `    <text ${textAttrs(style)}${dir} text-anchor="middle" x="0" y="${fmt(-shift)}" transform="${transform}">${xmlEscape(label.text)}</text>\n`;
  };

  const livePoint = (label: PlacedPointLabel): string => {
    const style = label.style;
    const p = toScreenPoint(label.anchor);
    const metrics = scaledMetrics(label.text, style);
    const baselineY = p.y + (metrics.ascent - metrics.descent) / 2;
    let callout = '';
    if (style.calloutsEnabled) {
      const f = toScreenPoint(label.featurePoint);
      if (Math.hypot(f.x - p.x, f.y - p.y) > style.calloutMinDistance * scale) {
        callout = `    <path d="M ${fmt(f.x)} ${fmt(f.y)} L ${fmt(p.x)} ${fmt(p.y)}" fill="none" stroke="${hex(style.calloutColor)}" stroke-width="${fmt(style.calloutWidth * scale)}"/>\n`;
      }
    }
    const dir = /[֐-ࣿ]/.test(label.text) ? ' direction="rtl"' : '';
    return `${callout}    <text ${textAttrs(style)}${dir} text-anchor="middle" x="${fmt(p.x)}" y="${fmt(baselineY)}">${xmlEscape(label.text)}</text>\n`;
  };

  const outlinedLine = (label: PlacedLineLabel, index: number): string =>
    outlined(buildLineLabel(label, index, label.centerDist, zero), label.text);

  const outlinedPoint = (label: PlacedPointLabel): string => {
    const style = label.style;
    let callout = '';
    if (style.calloutsEnabled) {
      const f = toScreenPoint(label.featurePoint);
      const p = toScreenPoint(label.anchor);
      if (Math.hypot(f.x - p.x, f.y - p.y) > style.calloutMinDistance * scale) {
        callout = `    <path d="M ${fmt(f.x)} ${fmt(f.y)} L ${fmt(p.x)} ${fmt(p.y)}" fill="none" stroke="${hex(style.calloutColor)}" stroke-width="${fmt(style.calloutWidth * scale)}"/>\n`;
      }
    }
    return callout + outlined(buildPointLabel(label, zero), label.text);
  };

  const labelGroups = (layer: LayerSnapshot): string => {
    const lines = layout.lineLabels.filter((l) => l.layerId === layer.id);
    const points = layout.pointLabels.filter((l) => l.layerId === layer.id);
    const emitLine = options.text === 'live' ? liveLine : (l: PlacedLineLabel, i: number) => outlinedLine(l, i);
    const emitPoint = options.text === 'live' ? livePoint : outlinedPoint;

    // An index per street keeps repeated labels of one street distinct, as on screen.
    const streetIndex = new Map<string, number>();
    const indexOf = (l: PlacedLineLabel): number => {
      const key = `${l.layerId}|${l.featureId}`;
      const i = streetIndex.get(key) ?? 0;
      streetIndex.set(key, i + 1);
      return i;
    };

    if (layer.kind === 'roads') {
      let out = '';
      for (const sub of layer.roadSubLayers) {
        let inner = '';
        for (const l of lines.filter((candidate) => candidate.subId === sub.id)) inner += emitLine(l, indexOf(l));
        if (inner === '') continue;
        out += `  <g id="${sanitizeId(`labels-${layer.name}-${sub.name}`)}">\n${inner}  </g>\n`;
      }
      return out;
    }
    let inner = '';
    for (const l of lines) inner += emitLine(l, indexOf(l));
    for (const l of points) inner += emitPoint(l);
    return inner === '' ? '' : `  <g id="${sanitizeId(`labels-${layer.name}`)}">\n${inner}  </g>\n`;
  };

  // ── Assemble: bottom to top, layer 0 is the top row ───────────────────────
  const visible = [...project.layers].reverse().filter((layer) => layer.isVisible);
  const background =
    project.artboardBackgroundEnabled && project.artboardBackground
      ? `<rect x="0" y="0" width="${fmt(width)}" height="${fmt(height)}" fill="${hex(project.artboardBackground)}"/>\n`
      : '';
  const geometry = visible.map(layerGroup).join('');
  const icons = visible
    .map((layer) => {
      const inner = iconGroup(layer);
      return inner === '' ? '' : `  <g id="${sanitizeId(`icons-${layer.name}`)}">\n${inner}  </g>\n`;
    })
    .join('');
  const labels = visible.map(labelGroups).join('');
  const meta = options.embedBBoxMeta
    ? `<!-- bbox: ${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon} -->\n`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${fmt(width)}" height="${fmt(height)}"
     viewBox="0 0 ${fmt(width)} ${fmt(height)}">
  ${meta}<defs>
${defs.join('')}  </defs>
${background}${geometry}<g id="icons">
${icons}</g>
<g id="labels">
${labels}</g>
</svg>
`;
}
