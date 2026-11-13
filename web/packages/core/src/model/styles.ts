import { z } from 'zod';
import { optionalSchema } from './validation';

export const CodableColorSchema = z.looseObject({
  r: z.number(),
  g: z.number(),
  b: z.number(),
  a: z.number(),
});
export type CodableColor = z.infer<typeof CodableColorSchema>;

export const LineCapSchema = z.enum(['butt', 'round', 'square']);
export const LineJoinSchema = z.enum(['miter', 'round', 'bevel']);
export const MarkerShapeSchema = z.enum(['circle', 'square', 'diamond']);
export const LabelPlacementSchema = z.enum([
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
]);
export const LabelTypeCaseSchema = z.enum([
  'as_stored',
  'uppercase',
  'title_case',
  'lowercase',
  'sentence_case',
]);
export const LineLabelModeSchema = z.enum(['curved', 'horizontal', 'parallel']);
export const LinePositionSchema = z.enum(['above', 'on', 'below']);
export const LabelOverlapModeSchema = z.enum(['never', 'allow_if_required', 'allow']);
export const CalloutStyleSchema = z.enum(['simple_line', 'manhattan', 'curved', 'balloon']);
export const SymbolAnchorSchema = z.enum(['geometric_center', 'visual_center', 'centroid']);
export const LabelLayoutSchema = z.enum(['icon_left', 'icon_right', 'icon_above', 'icon_below']);
export const LabelTextAlignmentSchema = z.enum([
  'vertical_center',
  'align_top',
  'align_bottom',
]);

export const RoadStyleSchema = z.looseObject({
  color: CodableColorSchema,
  width: z.number(),
  opacity: z.number(),
  lineCap: LineCapSchema,
  lineJoin: LineJoinSchema,
  dashEnabled: z.boolean(),
  casingEnabled: z.boolean(),
  casingColor: CodableColorSchema,
  casingWidth: z.number(),
});
export type RoadStyle = z.infer<typeof RoadStyleSchema>;

export const AreaStyleSchema = z.looseObject({
  fillColor: CodableColorSchema,
  fillOpacity: z.number(),
  strokeEnabled: z.boolean(),
  strokeColor: CodableColorSchema,
  strokeWidth: z.number(),
});
export type AreaStyle = z.infer<typeof AreaStyleSchema>;

export const POIStyleSchema = z.looseObject({
  shape: MarkerShapeSchema,
  size: z.number(),
  fillColor: CodableColorSchema,
  strokeColor: CodableColorSchema,
  strokeWidth: z.number(),
});
export type POIStyle = z.infer<typeof POIStyleSchema>;

export const LabelStyleSchema = z.looseObject({
  enabled: z.boolean(),
  isVisible: z.boolean(),
  tagKey: z.string(),
  fallbackTagKey: z.string(),
  fontName: z.string(),
  fontWeight: z.string(),
  fontSize: z.number(),
  opacity: z.number(),
  color: CodableColorSchema,
  haloColor: CodableColorSchema,
  haloWidth: z.number(),
  typeCase: LabelTypeCaseSchema,
  tracking: z.number(),
  wordSpacing: z.number(),
  placement: LabelPlacementSchema,
  offsetX: z.number(),
  offsetY: z.number(),
  lineLabelMode: LineLabelModeSchema,
  linePosition: LinePositionSchema,
  distanceFromLine: z.number(),
  repeatInterval: z.number(),
  minSpacing: z.number(),
  maxCharAngle: z.number(),
  overlapMode: LabelOverlapModeSchema,
  showAllLabels: z.boolean(),
  priority: z.number().int(),
  textStyleId: optionalSchema(z.uuid()),
  bufferEnabled: z.boolean(),
  bufferOpacity: z.number(),
  bufferJoinStyle: LineJoinSchema,
  shadowEnabled: z.boolean(),
  shadowColor: CodableColorSchema,
  shadowOpacity: z.number(),
  shadowBlur: z.number(),
  shadowOffsetX: z.number(),
  shadowOffsetY: z.number(),
  calloutsEnabled: z.boolean(),
  calloutStyle: CalloutStyleSchema,
  calloutColor: CodableColorSchema,
  calloutWidth: z.number(),
  calloutMinDistance: z.number(),
  uppercase: z.boolean(),
});
export type LabelStyle = z.infer<typeof LabelStyleSchema>;

export const SymbolStyleSchema = z.looseObject({
  enabled: z.boolean(),
  isVisible: z.boolean(),
  iconId: optionalSchema(z.uuid()),
  inlineSVGData: optionalSchema(z.base64()),
  width: z.number(),
  height: z.number(),
  lockAspect: z.boolean(),
  rotation: z.number(),
  opacity: z.number(),
  blendMode: z.string(),
  anchorPoint: SymbolAnchorSchema,
  collisionMargin: z.number(),
  allowOverlapWithOtherLayers: z.boolean(),
  bindToLabels: z.boolean(),
  labelLayout: LabelLayoutSchema,
  iconTextGap: z.number(),
  textAlignment: LabelTextAlignmentSchema,
});
export type SymbolStyle = z.infer<typeof SymbolStyleSchema>;

const DARK_GRAY: CodableColor = { r: 0.2, g: 0.2, b: 0.2, a: 1 };
const WHITE: CodableColor = { r: 1, g: 1, b: 1, a: 1 };

/** Exact Swift constructor defaults, used by the same shallow fill as ProjectManager. */
export const DEFAULT_ROAD_STYLE: RoadStyle = {
  color: DARK_GRAY,
  width: 2,
  opacity: 1,
  lineCap: 'round',
  lineJoin: 'round',
  dashEnabled: false,
  casingEnabled: false,
  casingColor: WHITE,
  casingWidth: 4,
};

export const DEFAULT_AREA_STYLE: AreaStyle = {
  fillColor: { r: 0.784, g: 0.902, b: 0.784, a: 1 },
  fillOpacity: 0.8,
  strokeEnabled: true,
  strokeColor: { r: 0.647, g: 0.839, b: 0.647, a: 1 },
  strokeWidth: 1,
};

export const DEFAULT_POI_STYLE: POIStyle = {
  shape: 'circle',
  size: 8,
  fillColor: { r: 0.898, g: 0.224, b: 0.208, a: 1 },
  strokeColor: WHITE,
  strokeWidth: 1.5,
};

export const DEFAULT_LABEL_STYLE: LabelStyle = {
  enabled: false,
  isVisible: true,
  tagKey: 'name',
  fallbackTagKey: 'name:en',
  fontName: 'Helvetica Neue',
  fontWeight: 'Regular',
  fontSize: 9,
  opacity: 1,
  color: DARK_GRAY,
  haloColor: WHITE,
  haloWidth: 1.5,
  typeCase: 'as_stored',
  tracking: 20,
  wordSpacing: 0,
  placement: 'center',
  offsetX: 0,
  offsetY: 0,
  lineLabelMode: 'curved',
  linePosition: 'above',
  distanceFromLine: 2,
  repeatInterval: 200,
  minSpacing: 6,
  maxCharAngle: 25,
  overlapMode: 'never',
  showAllLabels: false,
  priority: 5,
  bufferEnabled: false,
  bufferOpacity: 1,
  bufferJoinStyle: 'round',
  shadowEnabled: false,
  shadowColor: { r: 0, g: 0, b: 0, a: 1 },
  shadowOpacity: 0.3,
  shadowBlur: 2,
  shadowOffsetX: 1,
  shadowOffsetY: 1,
  calloutsEnabled: false,
  calloutStyle: 'simple_line',
  calloutColor: { r: 0.533, g: 0.533, b: 0.533, a: 1 },
  calloutWidth: 0.5,
  calloutMinDistance: 4,
  uppercase: false,
};

export const DEFAULT_SYMBOL_STYLE: SymbolStyle = {
  enabled: false,
  isVisible: true,
  width: 24,
  height: 24,
  lockAspect: true,
  rotation: 0,
  opacity: 1,
  blendMode: 'normal',
  anchorPoint: 'geometric_center',
  collisionMargin: 8,
  allowOverlapWithOtherLayers: false,
  bindToLabels: false,
  labelLayout: 'icon_left',
  iconTextGap: 4,
  textAlignment: 'vertical_center',
};

export const TextStyleSchema = z.looseObject({
  id: z.uuid(),
  name: z.string(),
  fontName: z.string(),
  fontWeight: z.string(),
  fontSize: z.number(),
  opacity: z.number(),
  color: CodableColorSchema,
  haloColor: CodableColorSchema,
  haloWidth: z.number(),
  typeCase: LabelTypeCaseSchema,
  tracking: z.number(),
  wordSpacing: z.number(),
});
export type TextStyle = z.infer<typeof TextStyleSchema>;

export const MapColorSchemeSchema = z.looseObject({
  id: z.uuid(),
  name: z.string(),
  colors: z.record(z.string(), CodableColorSchema),
});
export type MapColorScheme = z.infer<typeof MapColorSchemeSchema>;
