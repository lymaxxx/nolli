/**
 * The project document, as the web app holds it in memory.
 *
 * The shapes follow the `.nolli` file (see docs/PROJECT_FORMAT.md) so that a
 * file loads and saves without loss. The one difference is the seven manual-edit
 * tables on a layer: the file stores them as flat `[key, value, key, value, …]`
 * arrays, and here they are `Map`s keyed by feature id.
 *
 * Objects may carry keys this version does not know about. They are kept as
 * they are and written back on save.
 */

/** A colour with each channel from 0 to 1. */
export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** `[longitude, latitude]` in degrees (GeoJSON order). */
export type Coordinate = [number, number];

/** `[dx, dy]` in artwork pixels (base-zoom pixels, y down). */
export type Vector = [number, number];

export const LINE_CAPS = ['butt', 'round', 'square'] as const;
export type LineCap = (typeof LINE_CAPS)[number];

export const LINE_JOINS = ['miter', 'round', 'bevel'] as const;
export type LineJoin = (typeof LINE_JOINS)[number];

export const MARKER_SHAPES = ['circle', 'square', 'diamond'] as const;
export type MarkerShape = (typeof MARKER_SHAPES)[number];

/** `above` and `below` are old names for `top` and `bottom`, kept so old files open. */
export const LABEL_PLACEMENTS = [
  'along_path',
  'center',
  'top_left',
  'top',
  'top_right',
  'left',
  'right',
  'bottom_left',
  'bottom',
  'bottom_right',
  'above',
  'below',
] as const;
export type LabelPlacement = (typeof LABEL_PLACEMENTS)[number];

export const LABEL_TYPE_CASES = [
  'as_stored',
  'uppercase',
  'title_case',
  'lowercase',
  'sentence_case',
] as const;
export type LabelTypeCase = (typeof LABEL_TYPE_CASES)[number];

export const LINE_LABEL_MODES = ['curved', 'horizontal', 'parallel'] as const;
export type LineLabelMode = (typeof LINE_LABEL_MODES)[number];

export const LINE_POSITIONS = ['above', 'on', 'below'] as const;
export type LinePosition = (typeof LINE_POSITIONS)[number];

export const LABEL_OVERLAP_MODES = ['never', 'allow_if_required', 'allow'] as const;
export type LabelOverlapMode = (typeof LABEL_OVERLAP_MODES)[number];

export const CALLOUT_STYLES = ['simple_line', 'manhattan', 'curved', 'balloon'] as const;
export type CalloutStyle = (typeof CALLOUT_STYLES)[number];

export const NORTH_ARROW_POSITIONS = [
  'top_left',
  'top_right',
  'bottom_left',
  'bottom_right',
] as const;
export type NorthArrowPosition = (typeof NORTH_ARROW_POSITIONS)[number];

export const SYMBOL_ANCHORS = ['geometric_center', 'visual_center', 'centroid'] as const;
export type SymbolAnchor = (typeof SYMBOL_ANCHORS)[number];

export const LABEL_LAYOUTS = ['icon_left', 'icon_right', 'icon_above', 'icon_below'] as const;
export type LabelLayout = (typeof LABEL_LAYOUTS)[number];

export const LABEL_TEXT_ALIGNMENTS = ['vertical_center', 'align_top', 'align_bottom'] as const;
export type LabelTextAlignment = (typeof LABEL_TEXT_ALIGNMENTS)[number];

export const EXPORT_FORMATS = ['SVG', 'PDF', 'Illustrator'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const LAYER_KINDS = [
  'roads',
  'parks',
  'water',
  'buildings',
  'pedestrian_zones',
  'plazas',
  'landmarks',
  'transport',
  'dining',
  'accommodation',
  'healthcare',
  'parking',
  'shopping',
  'education',
  'background',
] as const;
export type LayerKind = (typeof LAYER_KINDS)[number];

export interface RoadStyle {
  color: Color;
  width: number;
  opacity: number;
  lineCap: LineCap;
  lineJoin: LineJoin;
  dashEnabled: boolean;
  casingEnabled: boolean;
  casingColor: Color;
  casingWidth: number;
}

export interface AreaStyle {
  fillColor: Color;
  fillOpacity: number;
  strokeEnabled: boolean;
  strokeColor: Color;
  strokeWidth: number;
}

export interface POIStyle {
  shape: MarkerShape;
  size: number;
  fillColor: Color;
  strokeColor: Color;
  strokeWidth: number;
}

export interface LabelStyle {
  enabled: boolean;
  /** The eye toggle on the labels, separate from `enabled`. */
  isVisible: boolean;
  /** The OpenStreetMap tag to read the text from, and the one to try if it is missing. */
  tagKey: string;
  fallbackTagKey: string;

  fontName: string;
  fontWeight: string;
  fontSize: number;
  opacity: number;
  color: Color;
  haloColor: Color;
  haloWidth: number;

  typeCase: LabelTypeCase;
  tracking: number;
  wordSpacing: number;

  placement: LabelPlacement;
  offsetX: number;
  offsetY: number;

  lineLabelMode: LineLabelMode;
  linePosition: LinePosition;
  distanceFromLine: number;
  repeatInterval: number;
  /** Clear margin around each label. Before file version 7 this meant something else; see the loader. */
  minSpacing: number;
  maxCharAngle: number;

  overlapMode: LabelOverlapMode;
  showAllLabels: boolean;
  priority: number;

  /** The saved text style this label is linked to, if any. */
  textStyleId?: string;

  bufferEnabled: boolean;
  bufferOpacity: number;
  bufferJoinStyle: LineJoin;

  shadowEnabled: boolean;
  shadowColor: Color;
  shadowOpacity: number;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;

  calloutsEnabled: boolean;
  calloutStyle: CalloutStyle;
  calloutColor: Color;
  calloutWidth: number;
  calloutMinDistance: number;

  /** Superseded by `typeCase`; kept because old files carry it. */
  uppercase: boolean;
}

export interface SymbolStyle {
  enabled: boolean;
  isVisible: boolean;
  /** An icon from the project's library. */
  iconId?: string;
  /** An icon imported just for this layer: SVG source, base64-encoded. */
  inlineSVGData?: string;
  width: number;
  height: number;
  lockAspect: boolean;
  rotation: number;
  opacity: number;
  blendMode: string;
  anchorPoint: SymbolAnchor;
  collisionMargin: number;
  allowOverlapWithOtherLayers: boolean;
  bindToLabels: boolean;
  labelLayout: LabelLayout;
  iconTextGap: number;
  textAlignment: LabelTextAlignment;
}

/**
 * One road type under the Roads layer (Primary, Secondary…). It inherits from
 * the layer field by field: `customStyle` and `labelStyle` always hold complete
 * styles, and the two override lists name the fields that are this type's own.
 * Every other field follows the layer's master style.
 */
export interface RoadSubLayer {
  id: string;
  name: string;
  /** The OpenStreetMap `highway` values this type covers. */
  roadTypes: string[];
  isVisible: boolean;
  customStyle: RoadStyle;
  lineOverrides: string[];
  labelStyle: LabelStyle;
  labelOverrides: string[];
  /** The width a brand-new type starts with. */
  defaultWidth?: number;
  /** Superseded by the override lists; kept because old files carry them. */
  useCustomStyle: boolean;
  useCustomLabelStyle: boolean;
}

/** Features keep their raw OpenStreetMap tags. Ids can be negative (ways built from relations). */
export interface LineFeature {
  id: number;
  tags: Record<string, string>;
  coordinates: Coordinate[];
}

export interface PolygonFeature {
  id: number;
  tags: Record<string, string>;
  /** Outer ring first. */
  rings: Coordinate[][];
}

export interface PointFeature {
  id: number;
  tags: Record<string, string>;
  coordinate: Coordinate;
}

/** Index 0 of a project's layers is the top row of the panel and draws on top. */
export interface Layer {
  id: string;
  name: string;
  kind: LayerKind;
  isVisible: boolean;
  roadStyle: RoadStyle;
  areaStyle: AreaStyle;
  poiStyle: POIStyle;
  labelStyle: LabelStyle;
  symbolStyle: SymbolStyle;
  roadSubLayers: RoadSubLayer[];
  lineFeatures: LineFeature[];
  polygonFeatures: PolygonFeature[];
  pointFeatures: PointFeature[];

  // Manual edits, keyed by feature id, in artwork pixels.
  /** Nudges of labels that move freely (not curved road names). */
  labelOffsets: Map<number, Vector>;
  /** Curved road names: a shift along the road. */
  labelAlongOffsets: Map<number, number>;
  /** Curved road names placed by hand, as distances along the road. An empty list hides the name. */
  labelPins: Map<number, number[]>;
  symbolOffsets: Map<number, Vector>;
  /** The fetched shape of anything reshaped by hand, so the edit can be undone. */
  originalLineGeometry: Map<number, Coordinate[]>;
  originalPolygonGeometry: Map<number, Coordinate[][]>;
  originalPointGeometry: Map<number, Coordinate>;
}

export interface BoundingBox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

export interface AppSettings {
  cacheDurationDays: number;
  defaultExportFormat: ExportFormat;
  defaultWidthMM: number;
  defaultHeightMM: number;
  defaultDPI: number;
  defaultFont: string;
  overpassEndpoint: string;
  showTileBackground: boolean;
  tileOpacity: number;
}

export interface SVGIcon {
  id: string;
  name: string;
  /** SVG source, base64-encoded. */
  svgData: string;
  width: number;
  height: number;
  lockAspect: boolean;
  opacity: number;
  blendMode: string;
}

/** A reusable typography preset. */
export interface TextStyle {
  id: string;
  name: string;
  fontName: string;
  fontWeight: string;
  fontSize: number;
  opacity: number;
  color: Color;
  haloColor: Color;
  haloWidth: number;
  typeCase: LabelTypeCase;
  tracking: number;
  wordSpacing: number;
}

/** A whole-map palette. Keys are `<kind>|<layer name>[|sub:<type>]|<slot>`. */
export interface MapColorScheme {
  id: string;
  name: string;
  colors: Record<string, Color>;
}

/** A physical sign: where it stands, which way it faces and how big its map face is. */
export interface SignOutput {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Facing direction, degrees clockwise from north. */
  rotation: number;
  isDoubleSided: boolean;
  backRotation: number;
  widthMM: number;
  heightMM: number;
  dpi: number;
  labelScale: number;
  iconScale: number;
  /** How far the framed map is shifted from the sign's position, in degrees. */
  centerOffsetLat: number;
  centerOffsetLon: number;
}

export interface Project {
  /** The format version the file was written with. Saving always writes the current one. */
  version: number;
  boundingBox?: BoundingBox;
  settings: AppSettings;
  layers: Layer[];
  iconLibrary: SVGIcon[];
  textStyles: TextStyle[];
  artboardRotation: number;
  showNorthArrow: boolean;
  northArrowPosition: NorthArrowPosition;
  /** The zoom level at which artwork sizes (line widths, text) are 1:1. */
  baseZoom: number;
  signArtworkScale: number;
  colorSwatches: Color[];
  colorSchemes: MapColorScheme[];
  artboardBackgroundEnabled: boolean;
  artboardBackground?: Color;
  signOutputs: SignOutput[];
  /** Where the view was when the file was saved. Absent in files from before the camera was stored. */
  cameraLat?: number;
  cameraLon?: number;
  cameraZoom?: number;
}

/** The format version this code writes. */
export const CURRENT_VERSION = 7;

/** File extensions that hold a project. `.mapcraft` is the app's former name; the format is the same. */
export const PROJECT_EXTENSIONS = ['nolli', 'mapcraft'] as const;
