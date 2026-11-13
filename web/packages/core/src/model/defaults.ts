import type {
  AppSettings,
  AreaStyle,
  Color,
  LabelStyle,
  POIStyle,
  RoadStyle,
  SignOutput,
  SymbolStyle,
} from './types';

/*
 * Default values, matching the Swift structs in macos/Nolli/Models. The loader
 * fills any key a file lacks from these, so a value changed here changes how
 * old files open. Each call returns a fresh object.
 */

const rgb = (r: number, g: number, b: number): Color => ({ r, g, b, a: 1 });

export const defaultRoadStyle = (): RoadStyle => ({
  color: rgb(0.2, 0.2, 0.2),
  width: 2,
  opacity: 1,
  lineCap: 'round',
  lineJoin: 'round',
  dashEnabled: false,
  casingEnabled: false,
  casingColor: rgb(1, 1, 1),
  casingWidth: 4,
});

export const defaultAreaStyle = (): AreaStyle => ({
  fillColor: rgb(0.784, 0.902, 0.784),
  fillOpacity: 0.8,
  strokeEnabled: true,
  strokeColor: rgb(0.647, 0.839, 0.647),
  strokeWidth: 1,
});

export const defaultPOIStyle = (): POIStyle => ({
  shape: 'circle',
  size: 8,
  fillColor: rgb(0.898, 0.224, 0.208),
  strokeColor: rgb(1, 1, 1),
  strokeWidth: 1.5,
});

export const defaultLabelStyle = (): LabelStyle => ({
  enabled: false,
  isVisible: true,
  tagKey: 'name',
  fallbackTagKey: 'name:en',
  fontName: 'Helvetica Neue',
  fontWeight: 'Regular',
  fontSize: 9,
  opacity: 1,
  color: rgb(0.2, 0.2, 0.2),
  haloColor: rgb(1, 1, 1),
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
  shadowColor: rgb(0, 0, 0),
  shadowOpacity: 0.3,
  shadowBlur: 2,
  shadowOffsetX: 1,
  shadowOffsetY: 1,
  calloutsEnabled: false,
  calloutStyle: 'simple_line',
  calloutColor: rgb(0.533, 0.533, 0.533),
  calloutWidth: 0.5,
  calloutMinDistance: 4,
  uppercase: false,
});

export const defaultSymbolStyle = (): SymbolStyle => ({
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
});

export const defaultAppSettings = (): AppSettings => ({
  cacheDurationDays: 7,
  defaultExportFormat: 'SVG',
  defaultWidthMM: 400,
  defaultHeightMM: 400,
  defaultDPI: 300,
  defaultFont: 'Helvetica Neue',
  overpassEndpoint: 'https://overpass.openstreetmap.fr/api/interpreter',
  showTileBackground: true,
  tileOpacity: 1,
});

/** Everything about a sign except its id and position, which have no default. */
export const defaultSignFields = (): Omit<SignOutput, 'id' | 'lat' | 'lon'> => ({
  name: 'Sign',
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
});

/** The label margin every layer carried by default before file version 7. */
export const LEGACY_DEFAULT_MIN_SPACING = 80;
