import { z } from 'zod';
import { LayerSnapshotSchema } from './layers';
import { CodableColorSchema, MapColorSchemeSchema, TextStyleSchema } from './styles';
import { optionalSchema } from './validation';

export const CURRENT_PROJECT_VERSION = 7;

export const ExportFormatSchema = z.enum(['SVG', 'PDF', 'Illustrator']);
export const NorthArrowPositionSchema = z.enum([
  'top_left',
  'top_right',
  'bottom_left',
  'bottom_right',
]);

export const BoundingBoxSchema = z.looseObject({
  minLat: z.number(),
  minLon: z.number(),
  maxLat: z.number(),
  maxLon: z.number(),
});
export type BoundingBox = z.infer<typeof BoundingBoxSchema>;

export const AppSettingsSchema = z.looseObject({
  cacheDurationDays: z.number().int(),
  defaultExportFormat: ExportFormatSchema,
  defaultWidthMM: z.number(),
  defaultHeightMM: z.number(),
  defaultDPI: z.number(),
  defaultFont: z.string(),
  overpassEndpoint: z.string(),
  showTileBackground: z.boolean(),
  tileOpacity: z.number(),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  cacheDurationDays: 7,
  defaultExportFormat: 'SVG',
  defaultWidthMM: 400,
  defaultHeightMM: 400,
  defaultDPI: 300,
  defaultFont: 'Helvetica Neue',
  overpassEndpoint: 'https://overpass.openstreetmap.fr/api/interpreter',
  showTileBackground: true,
  tileOpacity: 1,
};

export const SVGIconSchema = z.looseObject({
  id: z.uuid(),
  name: z.string(),
  svgData: z.base64(),
  width: z.number(),
  height: z.number(),
  lockAspect: z.boolean(),
  opacity: z.number(),
  blendMode: z.string(),
});
export type SVGIcon = z.infer<typeof SVGIconSchema>;

export const SignOutputSchema = z.looseObject({
  id: z.uuid(),
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  rotation: z.number(),
  isDoubleSided: z.boolean(),
  backRotation: z.number(),
  widthMM: z.number(),
  heightMM: z.number(),
  dpi: z.number(),
  labelScale: z.number(),
  iconScale: z.number(),
  centerOffsetLat: z.number(),
  centerOffsetLon: z.number(),
});
export type SignOutput = z.infer<typeof SignOutputSchema>;

export function signOutputDefaults(id: string): SignOutput {
  return {
    id,
    name: 'Sign',
    lat: 0,
    lon: 0,
    rotation: 0,
    isDoubleSided: false,
    backRotation: 180,
    widthMM: 400,
    heightMM: 400,
    dpi: 300,
    labelScale: 1,
    iconScale: 1,
    centerOffsetLat: 0,
    centerOffsetLon: 0,
  };
}

export const ProjectSnapshotSchema = z.looseObject({
  version: z.number().int(),
  boundingBox: optionalSchema(BoundingBoxSchema),
  settings: AppSettingsSchema,
  layers: z.array(LayerSnapshotSchema),
  iconLibrary: z.array(SVGIconSchema),
  textStyles: z.array(TextStyleSchema),
  artboardRotation: z.number(),
  showNorthArrow: z.boolean(),
  northArrowPosition: NorthArrowPositionSchema,
  baseZoom: z.number(),
  signArtworkScale: z.number(),
  colorSwatches: optionalSchema(z.array(CodableColorSchema)),
  colorSchemes: optionalSchema(z.array(MapColorSchemeSchema)),
  artboardBackgroundEnabled: optionalSchema(z.boolean()),
  artboardBackground: optionalSchema(CodableColorSchema),
  signOutputs: optionalSchema(z.array(SignOutputSchema)),
  cameraLat: optionalSchema(z.number()),
  cameraLon: optionalSchema(z.number()),
  cameraZoom: optionalSchema(z.number()),
});
export type ProjectSnapshot = z.infer<typeof ProjectSnapshotSchema>;

/** Nonoptional fields from ProjectSnapshot(settings: AppSettings(), layers: []). */
export const DEFAULT_PROJECT_FIELDS: ProjectSnapshot = {
  version: CURRENT_PROJECT_VERSION,
  settings: DEFAULT_APP_SETTINGS,
  layers: [],
  iconLibrary: [],
  textStyles: [],
  artboardRotation: 0,
  showNorthArrow: false,
  northArrowPosition: 'top_right',
  baseZoom: 15,
  signArtworkScale: 1,
};
