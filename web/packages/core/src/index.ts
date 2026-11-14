export { Polyline, type Point, type PathSample } from './geo/polyline';
export {
  type Affine,
  apply as applyAffine,
  IDENTITY as IDENTITY_AFFINE,
  invert as invertAffine,
  multiply as multiplyAffine,
  toCssMatrix,
} from './geometry/affine';
export {
  artworkTransform,
  fromScreen,
  fromScreenWorld,
  latLonAt,
  MAX_MERCATOR_LAT,
  projectionOf,
  relativeScreenTransform,
  screenTransform,
  TILE_SIZE,
  toScreen,
  toScreenWorld,
  worldDeltaFromScreen,
  worldPoint,
  type CameraPose,
  type Projection,
  type Viewport,
} from './projection/projection';
export {
  cameraForProject,
  clampCamera,
  clampLatitude,
  clampZoom,
  DEFAULT_CAMERA,
  fitBounds,
  MAX_LAT,
  MAX_ZOOM,
  MIN_LAT,
  MIN_ZOOM,
  normalizedRotation,
  panBy,
  rotateAround,
  rotateBy,
  sameCamera,
  zoomAround,
} from './camera/camera';
export {
  ancestorTile,
  tileCoverage,
  tileKey,
  TileCache,
  tileWorldTransform,
  tileZoom,
  wrapTileX,
  type AncestorTile,
  type TileCoverage,
  type TileLookup,
  type TilePlacement,
} from './tiles/tiles';
export {
  cellIntersects,
  compileScene,
  cssColor,
  featureKind,
  sceneCullRect,
  type Rect,
  type Scene,
  type SceneBatch,
  type SceneCell,
  type SceneMarker,
  type SceneMarkerBatch,
  type ScenePath,
} from './render/scene';
export { LoadedFont } from './text/font';
export {
  shapeLine,
  type ShapedGlyph,
  type ShapedUnit,
  type ShapedLine,
  type ShapeOptions,
} from './text/shape';
export {
  placeOnPath,
  angleDifference,
  type PlacedUnit,
  type PathTextOptions,
  type PathTextResult,
} from './text/pathText';
export { OSM_STANDARD, tileUrl, type TileSource, type RasterXYZSource } from './tiles/TileSource';
export * from './model/styles';
export * from './model/layers';
export * from './model/project';
export { flattenInt64Dictionary } from './model/int64Dictionary';
export { loadProject, serializeProject, upgradeProject } from './project/project';
export { vertexMean, areaCentroid, visualCenter } from './geo/polygonCenter';
export {
  TextMeasurer,
  type FontProvider,
  type MeasureStyle,
  type MetricUnit,
  type TextMetrics,
} from './text/metrics';
export {
  computeLabelLayout,
  glyphAnglesOK,
  intersects as rectsIntersect,
  labelPlacementKey,
  perpendicularExtent,
  resolvedText,
  spanBoxes,
  stitch,
  symbolAnchors,
  unitDirection,
  type MapLabelLayout,
  type PlacedIcon,
  type PlacedLineLabel,
  type PlacedPointLabel,
} from './layout/labels';
export {
  baselineShift,
  buildLineLabel,
  buildPointLabel,
  type GlyphInstance,
  type LabelGeometry,
  type LabelRun,
} from './render/labelGeometry';
export {
  compareLayouts,
  type Difference,
  type LayoutComparison,
  type LayoutDump,
} from './layout/compare';
export {
  FontRegistry,
  fontsUsed,
  isItalicStyle,
  matchFont,
  weightValue,
  type FontMatch,
  type FontRequest,
} from './text/registry';
export {
  applyColorScheme,
  captureColorScheme,
  cmykToRgb,
  colorToHex,
  hexToColor,
  hsbToRgb,
  paletteSample,
  rgbToCmyk,
  rgbToHsb,
  sameColor,
} from './model/color';
export {
  applyTextStyleToLabel,
  captureTextStyleFromLabel,
  changedStyleKeys,
  createLayer,
  hasManualEdits,
  LAYER_KIND_META,
  layerLabelFit,
  materializeProject,
  materializeRoadSubLayers,
  mergeInheritedStyle,
  resetManualEdits,
  resetRoadLabelOverrides,
  resetRoadLineOverrides,
  syncSubLabelStyles,
  syncSubLineStyles,
  updateRoadLabelStyle,
  updateRoadLineStyle,
  type LayerKindMeta,
  type LayerLabelFit,
} from './model/inheritance';
export {
  addProjectLayer,
  applyDocumentEdit,
  createDocumentHistory,
  markDocumentSaved,
  moveItem,
  moveProjectLayer,
  redoDocument,
  removeProjectLayer,
  undoDocument,
  updateProjectLayer,
  type DocumentHistory,
  type EditOptions,
} from './store/documentStore';
