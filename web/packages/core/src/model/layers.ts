import { z } from 'zod';
import { int64Schema, optionalInt64DictionarySchema } from './int64Dictionary';
import {
  AreaStyleSchema,
  DEFAULT_AREA_STYLE,
  DEFAULT_LABEL_STYLE,
  DEFAULT_POI_STYLE,
  DEFAULT_ROAD_STYLE,
  DEFAULT_SYMBOL_STYLE,
  LabelStyleSchema,
  POIStyleSchema,
  RoadStyleSchema,
  SymbolStyleSchema,
} from './styles';
import { optionalSchema } from './validation';

export const LayerKindSchema = z.enum([
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
]);
export type LayerKind = z.infer<typeof LayerKindSchema>;

/** Geometry arrays intentionally have no rank/length semantic validation, like Swift Codable. */
export const CoordinateSchema = z.array(z.number());
export const VectorSchema = z.tuple([z.number(), z.number()]);
export type Coordinate = z.infer<typeof CoordinateSchema>;
export type Vector = z.infer<typeof VectorSchema>;

export const LineFeatureSchema = z.looseObject({
  id: int64Schema,
  tags: z.record(z.string(), z.string()),
  coordinates: z.array(CoordinateSchema),
});
export type LineFeature = z.infer<typeof LineFeatureSchema>;

export const PolygonFeatureSchema = z.looseObject({
  id: int64Schema,
  tags: z.record(z.string(), z.string()),
  rings: z.array(z.array(CoordinateSchema)),
});
export type PolygonFeature = z.infer<typeof PolygonFeatureSchema>;

export const PointFeatureSchema = z.looseObject({
  id: int64Schema,
  tags: z.record(z.string(), z.string()),
  coordinate: CoordinateSchema,
});
export type PointFeature = z.infer<typeof PointFeatureSchema>;

const OverrideSetSchema = z.array(z.string()).transform((items) => new Set(items));

export const RoadSubLayerSchema = z.looseObject({
  id: z.uuid(),
  name: z.string(),
  roadTypes: z.array(z.string()),
  isVisible: z.boolean(),
  useCustomStyle: z.boolean(),
  customStyle: RoadStyleSchema,
  labelStyle: optionalSchema(LabelStyleSchema),
  labelOverrides: optionalSchema(OverrideSetSchema),
  lineOverrides: optionalSchema(OverrideSetSchema),
  defaultWidth: optionalSchema(z.number()),
  useCustomLabelStyle: z.boolean(),
});
export type RoadSubLayer = z.infer<typeof RoadSubLayerSchema>;

export function roadSubLayerDefaults(id: string): RoadSubLayer {
  return {
    id,
    name: '',
    roadTypes: [],
    isVisible: true,
    useCustomStyle: false,
    customStyle: DEFAULT_ROAD_STYLE,
    useCustomLabelStyle: false,
  };
}

export const LayerSnapshotSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  kind: LayerKindSchema,
  isVisible: z.boolean(),
  roadStyle: RoadStyleSchema,
  areaStyle: AreaStyleSchema,
  poiStyle: POIStyleSchema,
  labelStyle: LabelStyleSchema,
  symbolStyle: SymbolStyleSchema,
  roadSubLayers: z.array(RoadSubLayerSchema),
  lineFeatures: z.array(LineFeatureSchema),
  polygonFeatures: z.array(PolygonFeatureSchema),
  pointFeatures: z.array(PointFeatureSchema),
  labelOffsets: optionalInt64DictionarySchema(VectorSchema),
  labelAlongOffsets: optionalInt64DictionarySchema(z.number()),
  labelPins: optionalInt64DictionarySchema(z.array(z.number())),
  symbolOffsets: optionalInt64DictionarySchema(VectorSchema),
  originalLineGeometry: optionalInt64DictionarySchema(z.array(CoordinateSchema)),
  originalPolygonGeometry: optionalInt64DictionarySchema(z.array(z.array(CoordinateSchema))),
  originalPointGeometry: optionalInt64DictionarySchema(CoordinateSchema),
});
export type LayerSnapshot = z.infer<typeof LayerSnapshotSchema>;

/** Exposed for the shallow upgrader so this list cannot drift from the Swift styles. */
export const LAYER_STYLE_DEFAULTS = {
  roadStyle: DEFAULT_ROAD_STYLE,
  areaStyle: DEFAULT_AREA_STYLE,
  poiStyle: DEFAULT_POI_STYLE,
  labelStyle: DEFAULT_LABEL_STYLE,
  symbolStyle: DEFAULT_SYMBOL_STYLE,
};

