import { areaCentroid, vertexMean, visualCenter } from '../geo/polygonCenter';
import { Polyline, type Point } from '../geo/polyline';
import type { LabelStyle } from '../model/styles';
import type { LayerSnapshot, LineFeature } from '../model/layers';
import { worldPoint } from '../projection/projection';
import { featureKind, type Rect } from '../render/scene';
import { TextMeasurer, type TextMetrics } from '../text/metrics';

/*
 * Label and icon placement, ported from `LabelLayoutEngine` in
 * macos/Nolli/Views/LabelRendering.swift. Read that file alongside this one:
 * the order of the steps below is the behaviour, because each label claims
 * space the next ones must avoid.
 *
 * Everything here is in artwork space (Web Mercator pixels at the project's
 * base zoom) and does not depend on the view's zoom or rotation, so the screen
 * and every export use the same layout.
 */

/** A road name placed along its street. */
export interface PlacedLineLabel {
  layerId: string;
  /** The road type it belongs to; absent for lines in other layers. */
  subId?: string;
  /** The id of the first way of the stitched street. */
  featureId: number;
  text: string;
  /** The style it was placed with: resolved per road type, font size already scaled. */
  style: LabelStyle;
  line: Polyline;
  /** The label's centre, as an arc distance along `line`. */
  centerDist: number;
  width: number;
  metrics: TextMetrics;
  /** True for a label placed by hand. */
  pinned: boolean;
}

/** A point or area label. `anchor` is its centre; `featurePoint` is the feature itself (the far end of a callout). */
export interface PlacedPointLabel {
  layerId: string;
  featureId: number;
  text: string;
  style: LabelStyle;
  anchor: Point;
  featurePoint: Point;
  metrics: TextMetrics;
}

/** An icon that survived collision resolution. */
export interface PlacedIcon {
  layerId: string;
  featureId: number;
  point: Point;
}

export interface MapLabelLayout {
  lineLabels: PlacedLineLabel[];
  pointLabels: PlacedPointLabel[];
  icons: PlacedIcon[];
}

function placementStyleKey(style: LabelStyle): string {
  return [
    style.enabled ? 1 : 0,
    style.isVisible ? 1 : 0,
    style.tagKey,
    style.fallbackTagKey,
    style.fontName,
    style.fontWeight,
    style.fontSize,
    style.typeCase,
    style.tracking,
    style.wordSpacing,
    style.placement,
    style.offsetX,
    style.offsetY,
    style.lineLabelMode,
    style.linePosition,
    style.distanceFromLine,
    style.repeatInterval,
    style.minSpacing,
    style.maxCharAngle,
    style.overlapMode,
    style.showAllLabels ? 1 : 0,
    style.priority,
    style.bufferEnabled ? style.haloWidth : 0,
    style.calloutsEnabled ? style.calloutMinDistance : -1,
  ].join(':');
}

function mapEntriesKey(map: ReadonlyMap<number, unknown>): string {
  if (map.size === 0) return '';
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(',');
}

/**
 * Key of everything that affects label and icon placement, ported from
 * `LabelLayoutCache` in `LabelRendering.swift`. Changing colours, opacities,
 * road widths or area fills leaves this key unchanged so layout does not rerun.
 */
export function labelPlacementKey(
  layers: readonly LayerSnapshot[],
  baseZoom: number,
  labelScale = 1,
): string {
  const parts: string[] = [`${baseZoom}|${labelScale}`];
  for (const layer of layers) {
    const sym = layer.symbolStyle;
    parts.push(
      [
        layer.id,
        layer.kind,
        layer.isVisible ? 1 : 0,
        layer.lineFeatures.length,
        layer.polygonFeatures.length,
        layer.pointFeatures.length,
        placementStyleKey(layer.labelStyle),
        layer.roadSubLayers
          .map(
            (sub) =>
              `${sub.id}:${sub.isVisible ? 1 : 0}:${sub.roadTypes.join(',')}:${
                sub.labelStyle ? placementStyleKey(sub.labelStyle) : ''
              }`,
          )
          .join('/'),
        mapEntriesKey(layer.labelOffsets),
        mapEntriesKey(layer.symbolOffsets),
        mapEntriesKey(layer.labelPins),
        mapEntriesKey(layer.labelAlongOffsets),
        sym.enabled ? 1 : 0,
        sym.isVisible ? 1 : 0,
        sym.width,
        sym.height,
        sym.iconId ?? '',
        sym.inlineSVGData ? 1 : 0,
        sym.anchorPoint,
        sym.collisionMargin,
        sym.allowOverlapWithOtherLayers ? 1 : 0,
        sym.bindToLabels ? 1 : 0,
        sym.labelLayout,
        sym.iconTextGap,
        sym.textAlignment,
      ].join(';'),
    );
  }
  return parts.join('\n');
}

interface LineJob {
  layerId: string;
  subId?: string;
  chainId: number;
  text: string;
  metrics: TextMetrics;
  style: LabelStyle;
  line: Polyline;
  along: number;
  pins?: number[];
}

type Obstacles = Rect[];
type LabelPlacement = LabelStyle['placement'];

/**
 * Places icons, then hand-placed labels, then everything else.
 *
 * - Priority is layer order (top row first), and road types in their list order.
 * - Icons claim their space first, then hand-pinned road names, then the rest.
 * - A curved label only sits on a stretch with no bend sharper than "max angle",
 *   slides along the road to dodge bends and collisions, and is dropped when
 *   nothing fits.
 * - "Repeat distance" is the minimum gap between labels with the same text.
 * - "Margin" is the clear border kept around each label.
 */
export function computeLabelLayout(
  layers: readonly LayerSnapshot[],
  baseZoom: number,
  labelScale: number,
  measurer: TextMeasurer,
): MapLabelLayout {
  const layout: MapLabelLayout = { lineLabels: [], pointLabels: [], icons: [] };
  const obstacles: Obstacles = [];
  const sameText = new Map<string, Point[]>();

  // Icons first: they are the most fixed things on a map.
  for (const layer of layers) {
    if (layer.isVisible) placeIcons(layer, baseZoom, layout, obstacles);
  }

  // Gather road-name jobs per layer up front, so hand-placed names anywhere on
  // the map reserve their space before any automatic label is considered.
  const jobsByLayer = new Map<string, LineJob[]>();
  for (const layer of layers) {
    if (layer.isVisible && layer.lineFeatures.length > 0) {
      jobsByLayer.set(layer.id, lineJobs(layer, baseZoom, labelScale, measurer));
    }
  }
  for (const layer of layers) {
    if (!layer.isVisible) continue;
    for (const job of jobsByLayer.get(layer.id) ?? []) {
      if (!job.pins) continue;
      for (const d of job.pins) {
        const half = job.metrics.width / 2;
        const length = job.line.length;
        const c = Math.min(Math.max(d, Math.min(half, length / 2)), Math.max(length - half, length / 2));
        obstacles.push(
          ...spanBoxes(job.line, c, job.metrics.width, perpendicularExtent(job.style, job.metrics)),
        );
        pushPoint(sameText, job.text, job.line.pointAt(c));
        layout.lineLabels.push({
          layerId: job.layerId,
          subId: job.subId,
          featureId: job.chainId,
          text: job.text,
          style: job.style,
          line: job.line,
          centerDist: c,
          width: job.metrics.width,
          metrics: job.metrics,
          pinned: true,
        });
      }
    }
  }

  // Layer order is priority: index 0 is the top row and claims space first.
  for (const layer of layers) {
    if (!layer.isVisible) continue;
    // A layer can hold several kinds of feature (Pedestrian Zones has areas and
    // streets, Water has lakes and rivers). Areas and points go first.
    placePointLayer(layer, baseZoom, labelScale, layout, obstacles, measurer);
    for (const job of jobsByLayer.get(layer.id) ?? []) {
      if (!job.pins) placeAlong(job, layout, obstacles, sameText);
    }
  }
  return layout;
}

// MARK: Icons

/** The latitude, longitude and id of each feature of the layer that can carry an icon. */
export function symbolAnchors(
  layer: LayerSnapshot,
): { id: number; lat: number; lon: number }[] {
  const symbol = layer.symbolStyle;
  switch (featureKind(layer.kind)) {
    case 'polygon': {
      const anchors: { id: number; lat: number; lon: number }[] = [];
      for (const feature of layer.polygonFeatures) {
        const ring = feature.rings[0];
        if (!ring || ring.length === 0) continue;
        const [lat, lon] =
          symbol.anchorPoint === 'geometric_center'
            ? vertexMean(ring)
            : symbol.anchorPoint === 'centroid'
              ? areaCentroid(ring)
              : visualCenter(ring);
        anchors.push({ id: feature.id, lat, lon });
      }
      return anchors;
    }
    case 'point': {
      const anchors: { id: number; lat: number; lon: number }[] = [];
      for (const feature of layer.pointFeatures) {
        const [lon, lat] = feature.coordinate;
        if (feature.coordinate.length >= 2 && lon !== undefined && lat !== undefined) {
          anchors.push({ id: feature.id, lat, lon });
        }
      }
      return anchors;
    }
    case 'line':
      return [];
  }
}

function placeIcons(
  layer: LayerSnapshot,
  baseZoom: number,
  layout: MapLabelLayout,
  obstacles: Obstacles,
): void {
  const symbol = layer.symbolStyle;
  const hasIcon = symbol.inlineSVGData != null || symbol.iconId != null;
  if (!symbol.enabled || !symbol.isVisible || !hasIcon) return;

  for (const anchor of symbolAnchors(layer)) {
    const p = worldPoint(anchor.lat, anchor.lon, baseZoom);
    const moved = layer.symbolOffsets.get(anchor.id);
    if (moved) {
      p.x += moved[0];
      p.y += moved[1];
    }
    const box: Rect = {
      x: p.x - symbol.width / 2,
      y: p.y - symbol.height / 2,
      width: symbol.width,
      height: symbol.height,
    };
    if (!moved && !symbol.allowOverlapWithOtherLayers) {
      const margin = Math.max(symbol.collisionMargin, 0);
      const inflated = inset(box, -margin, -margin);
      if (obstacles.some((obstacle) => intersects(obstacle, inflated))) continue;
    }
    obstacles.push(box);
    layout.icons.push({ layerId: layer.id, featureId: anchor.id, point: p });
  }
}

// MARK: Road names

function isClosed(feature: LineFeature): boolean {
  const first = feature.coordinates[0];
  const last = feature.coordinates[feature.coordinates.length - 1];
  return (
    feature.coordinates.length >= 4 &&
    first !== undefined &&
    last !== undefined &&
    first.length === last.length &&
    first.every((value, index) => value === last[index])
  );
}

function lineJobs(
  layer: LayerSnapshot,
  baseZoom: number,
  labelScale: number,
  measurer: TextMeasurer,
): LineJob[] {
  // Buckets honour road-type order: a higher type wins space.
  const buckets: { style: LabelStyle; features: LineFeature[]; subId?: string }[] = [];
  if (layer.kind === 'roads') {
    // The master Labels row gates the whole road category; each type's own
    // flags refine within it.
    if (!layer.labelStyle.enabled || !layer.labelStyle.isVisible) return [];
    for (const sub of layer.roadSubLayers) {
      if (!sub.isVisible) continue;
      const types = new Set(sub.roadTypes);
      const features = layer.lineFeatures.filter((feature) => {
        const highway = tagValue(feature.tags, 'highway');
        return highway !== undefined && types.has(highway);
      });
      buckets.push({ style: sub.labelStyle ?? layer.labelStyle, features, subId: sub.id });
    }
  } else {
    // A street that is also mapped as a named area gets one label, on the area.
    // Outlines in a point layer are labelled at their centre instead.
    const style = layer.labelStyle;
    const areaNames = new Set<string>();
    for (const polygon of layer.polygonFeatures) {
      const name = resolvedText(polygon.tags, style);
      if (name !== undefined) areaNames.add(name);
    }
    const isPointLayer = featureKind(layer.kind) === 'point';
    const features = layer.lineFeatures.filter((feature) => {
      if (isPointLayer && isClosed(feature)) return false;
      const name = resolvedText(feature.tags, style);
      return name !== undefined && !areaNames.has(name);
    });
    buckets.push({ style, features });
  }

  const jobs: LineJob[] = [];
  for (const { style: rawStyle, features, subId } of buckets) {
    if (!rawStyle.enabled || !rawStyle.isVisible) continue;
    const style: LabelStyle = { ...rawStyle, fontSize: rawStyle.fontSize * labelScale };

    // Same-named ways sharing endpoints become one street, so the label centres
    // on the real road and repeats along its whole length.
    const groups = new Map<string, { id: number; points: Point[] }[]>();
    for (const feature of features) {
      const text = resolvedText(feature.tags, style);
      if (text === undefined) continue;
      const world: Point[] = [];
      for (const coordinate of feature.coordinates) {
        if (coordinate.length >= 2) {
          world.push(worldPoint(coordinate[1]!, coordinate[0]!, baseZoom));
        }
      }
      if (world.length < 2) continue;
      const group = groups.get(text);
      if (group) group.push({ id: feature.id, points: world });
      else groups.set(text, [{ id: feature.id, points: world }]);
    }

    for (const [text, ways] of groups) {
      const metrics = measurer.measure(text, style);
      if (!(metrics.width > 0)) continue;
      for (const chain of stitch(ways)) {
        let points = chain.points;
        const offset = layer.labelOffsets.get(chain.id);
        if (style.lineLabelMode !== 'curved' && offset && (offset[0] !== 0 || offset[1] !== 0)) {
          points = points.map((p) => ({ x: p.x + offset[0], y: p.y + offset[1] }));
        }
        const line = Polyline.tryCreate(points);
        if (!line) continue;
        const pins = layer.labelPins.get(chain.id);
        if (!(line.length > metrics.width + 4 || (pins !== undefined && line.length > 1))) continue;
        jobs.push({
          layerId: layer.id,
          subId,
          chainId: chain.id,
          text,
          metrics,
          style,
          line,
          along: layer.labelAlongOffsets.get(chain.id) ?? 0,
          pins,
        });
      }
    }
  }
  return jobs;
}

/**
 * Joins ways that share endpoints into longer chains, reversing as needed. It
 * only continues through a junction when the street keeps going roughly
 * straight, so a label is never routed around a T-junction.
 */
export function stitch(
  ways: readonly { id: number; points: Point[] }[],
): { id: number; points: Point[] }[] {
  const chains = ways.map((way) => ({ id: way.id, points: way.points }));
  if (chains.length <= 1) return chains;
  const epsilon = 0.05;
  const close = (a: Point, b: Point) => Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon;
  // Whether a's end flows into b's start without turning more than 60 degrees.
  const smooth = (a: Point[], b: Point[]): boolean => {
    if (a.length < 2 || b.length < 2) return true;
    const p = a[a.length - 2]!;
    const q = a[a.length - 1]!;
    const r = b[1]!;
    const a1 = Math.atan2(q.y - p.y, q.x - p.x);
    const a2 = Math.atan2(r.y - q.y, r.x - q.x);
    let d = (Math.abs(a2 - a1) * 180) / Math.PI;
    if (d > 180) d = 360 - d;
    return d < 60;
  };

  let merged = true;
  while (merged && chains.length > 1) {
    merged = false;
    search: for (let i = 0; i < chains.length; i++) {
      for (let j = i + 1; j < chains.length; j++) {
        const a = chains[i]!.points;
        const b = chains[j]!.points;
        const af = a[0];
        const al = a[a.length - 1];
        const bf = b[0];
        const bl = b[b.length - 1];
        if (!af || !al || !bf || !bl) continue;
        const br = [...b].reverse();
        const ar = [...a].reverse();
        let joined: Point[] | undefined;
        if (close(al, bf) && smooth(a, b)) joined = [...a, ...b.slice(1)];
        else if (close(al, bl) && smooth(a, br)) joined = [...a, ...br.slice(1)];
        else if (close(af, bl) && smooth(b, a)) joined = [...b, ...a.slice(1)];
        else if (close(af, bf) && smooth(ar, b)) joined = [...ar, ...b.slice(1)];
        if (joined) {
          chains[i] = { id: chains[i]!.id, points: joined };
          chains.splice(j, 1);
          merged = true;
          break search;
        }
      }
    }
  }
  return chains;
}

function placeAlong(
  job: LineJob,
  layout: MapLabelLayout,
  obstacles: Obstacles,
  sameText: Map<string, Point[]>,
): void {
  const { line, style, metrics, text } = job;
  const length = line.length;
  const width = metrics.width;
  const halfWidth = width / 2;
  const anchor = Math.min(
    Math.max(length / 2 + job.along, Math.min(halfWidth, length / 2)),
    Math.max(length - halfWidth, length / 2),
  );

  // Valid stretches: the gaps between sharp bends (curved labels only).
  const intervals: [number, number][] = [];
  if (style.lineLabelMode === 'curved') {
    const bounds = [0, ...line.sharpVertexDistances(style.maxCharAngle), length].sort((a, b) => a - b);
    for (let i = 0; i < bounds.length - 1; i++) {
      if (bounds[i + 1]! - bounds[i]! >= width) intervals.push([bounds[i]!, bounds[i + 1]!]);
    }
  } else if (length >= width) {
    intervals.push([0, length]);
  }
  if (intervals.length === 0) return;

  // Desired centres: the anchor, then outwards every repeat step.
  const repeat = Math.max(style.repeatInterval, width + 8);
  const desired = [anchor];
  for (let k = 1; ; k++) {
    const lo = anchor - k * repeat;
    const hi = anchor + k * repeat;
    let any = false;
    if (lo - halfWidth >= 0) {
      desired.push(lo);
      any = true;
    }
    if (hi + halfWidth <= length) {
      desired.push(hi);
      any = true;
    }
    if (!any) break;
  }

  const margin = Math.max(style.minSpacing, 0);
  const perpendicular = perpendicularExtent(style, metrics);
  const ignore = style.showAllLabels || style.overlapMode === 'allow';

  const commit = (c: number, boxes: Rect[]) => {
    obstacles.push(...boxes);
    pushPoint(sameText, text, line.pointAt(c));
    layout.lineLabels.push({
      layerId: job.layerId,
      subId: job.subId,
      featureId: job.chainId,
      text,
      style,
      line,
      centerDist: c,
      width,
      metrics,
      pinned: false,
    });
  };
  const tooCloseToSame = (point: Point) =>
    (sameText.get(text) ?? []).some((previous) => Math.hypot(previous.x - point.x, previous.y - point.y) < repeat);

  desired.forEach((d, index) => {
    // The stretch nearest the desired centre; the first wins a tie.
    let interval: [number, number] | undefined;
    let nearest = Number.POSITIVE_INFINITY;
    for (const candidate of intervals) {
      const distance = distanceToInterval(d, candidate);
      if (distance < nearest) {
        nearest = distance;
        interval = candidate;
      }
    }
    if (!interval) return;
    const cMin = interval[0] + halfWidth;
    const cMax = interval[1] - halfWidth;
    if (cMin > cMax) return;
    const base = Math.min(Math.max(d, cMin), cMax);

    // Slide along the road to dodge bends and collisions.
    const step = Math.max(width / 4, style.fontSize);
    const candidates = [base];
    for (let s = step; s < interval[1] - interval[0] && candidates.length <= 32; s += step) {
      if (base + s <= cMax) candidates.push(base + s);
      if (base - s >= cMin) candidates.push(base - s);
    }

    let placed = false;
    for (const c of candidates) {
      if (tooCloseToSame(line.pointAt(c))) continue;
      if (
        style.lineLabelMode === 'curved' &&
        !glyphAnglesOK(line, c, metrics, style.fontSize, style.maxCharAngle)
      ) {
        continue;
      }
      const boxes = spanBoxes(line, c, width, perpendicular);
      if (!ignore) {
        const pad = style.overlapMode === 'allow_if_required' ? 0 : margin;
        const inflated = boxes.map((box) => inset(box, -pad, -pad));
        if (inflated.some((box) => obstacles.some((obstacle) => intersects(obstacle, box)))) continue;
      }
      commit(c, boxes);
      placed = true;
      break;
    }

    // "Allow if required": a street's first label appears even if it has to
    // overlap something, when no clear spot exists.
    if (!placed && index === 0 && style.overlapMode === 'allow_if_required') {
      if (!tooCloseToSame(line.pointAt(base))) {
        commit(base, spanBoxes(line, base, width, perpendicular));
      }
    }
  });
}

/** How far the drawn text extends sideways from the guide line; sizes the collision boxes. */
export function perpendicularExtent(style: LabelStyle, metrics: TextMetrics): number {
  const h = metrics.ascent + metrics.descent;
  return style.linePosition === 'on' ? h / 2 + 1 : style.distanceFromLine + h * 0.75 + 1;
}

function distanceToInterval(d: number, interval: readonly [number, number]): number {
  if (d < interval[0]) return interval[0] - d;
  if (d > interval[1]) return d - interval[1];
  return 0;
}

/** Collision boxes sampled along the label's span. */
export function spanBoxes(
  line: Polyline,
  centerDist: number,
  width: number,
  halfHeight: number,
): Rect[] {
  const start = centerDist - width / 2;
  const sampleStep = Math.max(halfHeight * 1.2, 4);
  const boxes: Rect[] = [];
  for (let d = 0; d <= width; d += sampleStep) {
    const p = line.pointAt(start + d);
    boxes.push({ x: p.x - halfHeight, y: p.y - halfHeight, width: halfHeight * 2, height: halfHeight * 2 });
  }
  return boxes;
}

/**
 * Neighbouring letters' chord angles must not differ by more than `maxDegrees`.
 * Angles are sampled over at least 0.6 em, so tiny vertices do not make letters
 * jitter (the same window the drawing code rotates with).
 *
 * A whole word of a joined script is one rigid piece, so it is also checked
 * against itself: its two halves must not point in directions further apart
 * than the limit. This has no counterpart in the macOS app, which would draw
 * such a word letter by letter and break its joins.
 */
export function glyphAnglesOK(
  line: Polyline,
  centerDist: number,
  metrics: TextMetrics,
  fontSize: number,
  maxDegrees: number,
): boolean {
  const start = centerDist - metrics.width / 2;
  const minWindow = fontSize * 0.6;
  let previous: number | undefined;
  const differs = (a: number, b: number): boolean => {
    let delta = Math.abs(a - b);
    if (delta > 180) delta = 360 - delta;
    return delta > maxDegrees;
  };
  for (const { unit, x, advance } of metrics.units) {
    if (!(advance > 0.1)) continue;
    const mid = start + x + advance / 2;
    const half = Math.max(advance, minWindow) / 2;
    const angle = (line.chordAngle(mid - half, mid + half) * 180) / Math.PI;
    if (previous !== undefined && differs(angle, previous)) return false;
    previous = angle;
    if (unit.rigid) {
      const first = (line.chordAngle(mid - advance / 2, mid) * 180) / Math.PI;
      const second = (line.chordAngle(mid, mid + advance / 2) * 180) / Math.PI;
      if (differs(first, second)) return false;
    }
  }
  return true;
}

// MARK: Point and area labels

function placePointLayer(
  layer: LayerSnapshot,
  baseZoom: number,
  labelScale: number,
  layout: MapLabelLayout,
  obstacles: Obstacles,
  measurer: TextMeasurer,
): void {
  if (!layer.labelStyle.enabled || !layer.labelStyle.isVisible) return;
  const style: LabelStyle = { ...layer.labelStyle, fontSize: layer.labelStyle.fontSize * labelScale };
  const symbol = layer.symbolStyle;
  const bound = symbol.enabled && symbol.isVisible && symbol.bindToLabels;
  const iconPoints = new Map<number, Point>();
  for (const icon of layout.icons) {
    if (icon.layerId === layer.id && !iconPoints.has(icon.featureId)) {
      iconPoints.set(icon.featureId, icon.point);
    }
  }

  const place = (featureId: number, lat: number, lon: number, tags: Record<string, string>) => {
    const text = resolvedText(tags, style);
    if (text === undefined) return;
    const metrics = measurer.measure(text, style);
    if (!(metrics.width > 0)) return;
    const feature = worldPoint(lat, lon, baseZoom);
    const h = metrics.ascent + metrics.descent;
    let anchor: Point = { ...feature };
    const ownIcon = iconPoints.get(featureId);

    if (bound && ownIcon) {
      // The text sits beside its icon, as the Label Binding settings say.
      anchor = { ...ownIcon };
      const gx = symbol.width / 2 + symbol.iconTextGap + metrics.width / 2;
      const gy = symbol.height / 2 + symbol.iconTextGap + h / 2;
      switch (symbol.labelLayout) {
        case 'icon_left':
          anchor.x += gx;
          break;
        case 'icon_right':
          anchor.x -= gx;
          break;
        case 'icon_above':
          anchor.y += gy;
          break;
        case 'icon_below':
          anchor.y -= gy;
          break;
      }
      if (symbol.labelLayout === 'icon_left' || symbol.labelLayout === 'icon_right') {
        const extra = (symbol.height - h) / 2;
        if (symbol.textAlignment === 'align_top') anchor.y -= extra;
        else if (symbol.textAlignment === 'align_bottom') anchor.y += extra;
      }
    } else {
      let direction = unitDirection(style.placement);
      let gapX = metrics.width / 2 + Math.max(style.fontSize * 0.4, 4);
      let gapY = h / 2 + Math.max(style.fontSize * 0.3, 3);
      if (ownIcon) {
        // Clear the feature's icon; a centred label goes under it.
        anchor = { ...ownIcon };
        gapX += symbol.width / 2;
        gapY += symbol.height / 2;
        if (direction.dx === 0 && direction.dy === 0) direction = { dx: 0, dy: 1 };
      }
      anchor.x += direction.dx * gapX + style.offsetX;
      anchor.y += direction.dy * gapY - style.offsetY;
    }

    const moved = layer.labelOffsets.get(featureId);
    if (moved) {
      anchor.x += moved[0];
      anchor.y += moved[1];
    }
    const pad = Math.max(style.bufferEnabled ? style.haloWidth : 0, 1);
    const box: Rect = {
      x: anchor.x - metrics.width / 2 - pad,
      y: anchor.y - h / 2 - pad,
      width: metrics.width + pad * 2,
      height: h + pad * 2,
    };
    if (!moved && !(style.showAllLabels || style.overlapMode === 'allow')) {
      const margin = style.overlapMode === 'allow_if_required' ? 0 : Math.max(style.minSpacing, 0);
      const inflated = inset(box, -margin, -margin);
      // A label never competes with its own icon.
      const ownBox: Rect | undefined = ownIcon && {
        x: ownIcon.x - symbol.width / 2,
        y: ownIcon.y - symbol.height / 2,
        width: symbol.width,
        height: symbol.height,
      };
      if (
        style.overlapMode !== 'allow_if_required' &&
        obstacles.some((obstacle) => !(ownBox && sameRect(obstacle, ownBox)) && intersects(obstacle, inflated))
      ) {
        return;
      }
    }
    obstacles.push(box);
    layout.pointLabels.push({
      layerId: layer.id,
      featureId,
      text,
      style,
      anchor,
      featurePoint: feature,
      metrics,
    });
  };

  for (const feature of layer.polygonFeatures) {
    const ring = feature.rings[0];
    if (Object.keys(feature.tags).length === 0 || !ring || ring.length === 0) continue;
    const [lat, lon] = areaCentroid(ring);
    place(feature.id, lat, lon, feature.tags);
  }
  for (const feature of layer.pointFeatures) {
    if (feature.coordinate.length < 2) continue;
    place(feature.id, feature.coordinate[1]!, feature.coordinate[0]!, feature.tags);
  }
  if (featureKind(layer.kind) === 'point') {
    for (const feature of layer.lineFeatures) {
      if (!isClosed(feature)) continue;
      const [lat, lon] = areaCentroid(feature.coordinates);
      place(feature.id, lat, lon, feature.tags);
    }
  }
}

/** The direction a label is pushed from its feature: x −1 left, +1 right; y −1 up, +1 down. */
export function unitDirection(placement: LabelPlacement): { dx: number; dy: number } {
  switch (placement) {
    case 'along_path':
    case 'center':
      return { dx: 0, dy: 0 };
    case 'top_left':
      return { dx: -1, dy: -1 };
    case 'top':
    case 'above':
      return { dx: 0, dy: -1 };
    case 'top_right':
      return { dx: 1, dy: -1 };
    case 'left':
      return { dx: -1, dy: 0 };
    case 'right':
      return { dx: 1, dy: 0 };
    case 'bottom_left':
      return { dx: -1, dy: 1 };
    case 'bottom':
    case 'below':
      return { dx: 0, dy: 1 };
    case 'bottom_right':
      return { dx: 1, dy: 1 };
  }
}

// MARK: Text

/** An own property of a tag set, so a tag called "constructor" is not mistaken for a method. */
function tagValue(tags: Record<string, string>, key: string): string | undefined {
  return Object.hasOwn(tags, key) ? tags[key] : undefined;
}

/** The text a feature's label shows, or undefined when it has none. */
export function resolvedText(tags: Record<string, string>, style: LabelStyle): string | undefined {
  const raw = tagValue(tags, style.tagKey) ?? tagValue(tags, style.fallbackTagKey) ?? '';
  if (raw === '') return undefined;
  switch (style.typeCase) {
    case 'as_stored':
      return raw;
    case 'uppercase':
      return raw.toUpperCase();
    case 'lowercase':
      return raw.toLowerCase();
    case 'title_case':
      return raw
        .split(' ')
        .map((word) => (word === '' ? '' : upperFirst(word)))
        .join(' ');
    case 'sentence_case':
      return upperFirst(raw);
  }
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The text with its first character (a whole user-perceived character) in upper case. */
function upperFirst(text: string): string {
  const first = segmenter.segment(text)[Symbol.iterator]().next();
  if (first.done) return text;
  const head = first.value.segment;
  return head.toUpperCase() + text.slice(head.length);
}

// MARK: Rectangles

/** True when the rectangles share area. Rectangles that only touch do not intersect. */
export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function inset(rect: Rect, dx: number, dy: number): Rect {
  return { x: rect.x + dx, y: rect.y + dy, width: rect.width - dx * 2, height: rect.height - dy * 2 };
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function pushPoint(map: Map<string, Point[]>, key: string, point: Point): void {
  const list = map.get(key);
  if (list) list.push(point);
  else map.set(key, [point]);
}
