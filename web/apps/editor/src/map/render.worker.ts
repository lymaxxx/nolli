import {
  buildLineLabel,
  buildPointLabel,
  compileScene,
  computeLabelLayout,
  exportSVG,
  FontRegistry,
  labelPlacementKey,
  layerLabelFit,
  LoadedFont,
  OSM_STANDARD,
  projectionOf,
  TextMeasurer,
  type CameraPose,
  type LabelGeometry,
  type LayerLabelFit,
  type LayerSnapshot,
  type RasterXYZSource,
  type Scene,
} from '@nolli/core';
import { drawLabels } from './drawLabels';
import { drawScene } from './drawScene';
import { loadFallbackFonts } from './fonts';
import { drawTiles } from './drawTiles';
import type { MainMessage, WorkerMessage } from './messages';
import { surfaceMetrics } from './surface';
import { TileLoader } from './tileStore';

interface WorkerScope {
  postMessage(message: WorkerMessage): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<MainMessage>) => void,
  ): void;
}

const scope = self as unknown as WorkerScope;

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let scene: Scene | null = null;
let labels: LabelGeometry[] = [];
let labelFits: Record<string, LayerLabelFit> = {};
let lastPlacementKey: string | null = null;
/** The scene origin the current label geometry is relative to; if it changes, the geometry must be rebuilt. */
let labelsOrigin: { x: number; y: number } | null = null;
let labelMs = 0;
let labelToken = 0;
let camera: CameraPose | null = null;
let viewport = { width: 0, height: 0 };
let dpr = 1;
let source: RasterXYZSource = OSM_STANDARD;
let showTiles = true;
let tileOpacity = 1;
let background: string | null = null;
let redrawTimer: ReturnType<typeof setTimeout> | null = null;

const loader = new TileLoader(source, () => scheduleRedraw());

function drawNow(epoch: number | null): void {
  if (!ctx || !canvas || !camera || viewport.width <= 0 || viewport.height <= 0) return;

  const started = performance.now();
  const projection = projectionOf(camera, viewport);
  const metrics = surfaceMetrics(viewport, dpr);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#ededed';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const tiles =
    showTiles && tileOpacity > 0
      ? drawTiles(ctx, projection, source, loader, metrics, tileOpacity)
      : { tileCount: 0, missingTiles: 0 };
  if (background) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  if (scene) {
    drawScene(ctx, scene, projection, metrics);
    drawLabels(ctx, labels, scene, projection, metrics);
  }

  scope.postMessage({
    type: 'drawn',
    camera,
    epoch,
    renderMs: performance.now() - started,
    featureCount: scene?.featureCount ?? 0,
    labelCount: labels.length,
    labelMs,
    tileCount: tiles.tileCount,
    missingTiles: tiles.missingTiles,
    labelFits,
  });
}

let fallbackFonts: ReturnType<typeof loadFallbackFonts> | null = null;
let fontFiles: { family: string; style: string; data: ArrayBuffer }[] = [];
let layers: LayerSnapshot[] = [];
let layersBaseZoom = 15;

/** Refreshes paint-only label style fields when placement itself has not changed (`LabelLayoutCache`). */
function refreshLabelPaintStyles(): void {
  const byLayer = new Map<string, LayerSnapshot>();
  for (const layer of layers) byLayer.set(layer.id, layer);
  labels = labels.map((label) => {
    const layer = byLayer.get(label.layerId);
    if (!layer) return label;
    const style = label.subId
      ? (layer.roadSubLayers.find((sub) => sub.id === label.subId)?.labelStyle ?? layer.labelStyle)
      : layer.labelStyle;
    return { ...label, style };
  });
}

/** The registry for the project's font files, with the built-in fonts behind it. */
async function currentRegistry(): Promise<FontRegistry> {
  fallbackFonts ??= loadFallbackFonts();
  const registry = new FontRegistry(await fallbackFonts);
  for (const file of fontFiles) {
    try {
      registry.add(file.family, file.style, new LoadedFont(file.data));
    } catch {
      // A file that is not a usable font is ignored; the family falls back.
    }
  }
  return registry;
}

/**
 * Places labels for the current project and turns them into glyphs. Runs after
 * the first draw so the map appears at once and the names follow.
 */
async function buildLabels(token: number, placementKey: string): Promise<void> {
  try {
    const registry = await currentRegistry();
    if (token !== labelToken || !scene) return;
    const started = performance.now();
    const layout = computeLabelLayout(layers, layersBaseZoom, 1, new TextMeasurer(registry));
    const origin = scene.origin;
    const built: LabelGeometry[] = [];
    const seen = new Map<string, number>();
    for (const placed of layout.lineLabels) {
      const streetKey = `${placed.layerId}|${placed.featureId}`;
      const index = seen.get(streetKey) ?? 0;
      seen.set(streetKey, index + 1);
      built.push(buildLineLabel(placed, index, placed.centerDist, origin));
    }
    for (const placed of layout.pointLabels) built.push(buildPointLabel(placed, origin));
    const fits: Record<string, LayerLabelFit> = {};
    for (const layer of layers) {
      fits[layer.id] = layerLabelFit(layer, layout);
    }
    if (token !== labelToken) return;
    labels = built;
    labelFits = fits;
    lastPlacementKey = placementKey;
    labelsOrigin = { x: origin.x, y: origin.y };
    labelMs = performance.now() - started;
    drawNow(null);
  } catch (error) {
    if (token !== labelToken) return;
    scope.postMessage({
      type: 'error',
      message: `Labels could not be placed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

/** Tile arrivals redraw at most once a frame; they never queue up. */
function scheduleRedraw(): void {
  if (redrawTimer !== null) return;
  redrawTimer = setTimeout(() => {
    redrawTimer = null;
    drawNow(null);
  }, 16);
}

scope.addEventListener('message', (event) => {
  const message = event.data;
  switch (message.type) {
    case 'init': {
      canvas = message.canvas;
      ctx = canvas.getContext('2d');
      if (!ctx) {
        scope.postMessage({ type: 'error', message: 'The map canvas could not be created.' });
      }
      break;
    }
    case 'surface': {
      viewport = { width: message.width, height: message.height };
      dpr = message.dpr;
      if (canvas) {
        const metrics = surfaceMetrics(viewport, dpr);
        canvas.width = Math.max(1, Math.round(metrics.cssWidth * dpr));
        canvas.height = Math.max(1, Math.round(metrics.cssHeight * dpr));
      }
      drawNow(null);
      break;
    }
    case 'project': {
      try {
        scene = compileScene(message.layers, message.baseZoom);
        layers = message.layers;
        layersBaseZoom = message.baseZoom;
        const nextPlacementKey = labelPlacementKey(layers, layersBaseZoom, 1);
        // Label geometry is relative to the scene origin, so reuse it only if the origin is unchanged.
        const sameOrigin =
          labelsOrigin !== null && labelsOrigin.x === scene.origin.x && labelsOrigin.y === scene.origin.y;
        if (nextPlacementKey === lastPlacementKey && sameOrigin) {
          refreshLabelPaintStyles();
          drawNow(null);
        } else {
          labelToken += 1;
          drawNow(null);
          void buildLabels(labelToken, nextPlacementKey);
        }
      } catch (error) {
        scene = null;
        scope.postMessage({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
      break;
    }
    case 'view': {
      showTiles = message.showTiles;
      tileOpacity = message.tileOpacity;
      background = message.background;
      source = message.source;
      loader.setSource(source);
      scheduleRedraw();
      break;
    }
    case 'fonts': {
      fontFiles = message.fonts;
      lastPlacementKey = null;
      if (scene) {
        // Keep the old labels on screen until the new ones are ready.
        labelToken += 1;
        void buildLabels(labelToken, labelPlacementKey(layers, layersBaseZoom, 1));
      }
      break;
    }
    case 'exportSvg': {
      const { id, project: exported, options } = message;
      void (async () => {
        try {
          const registry = await currentRegistry();
          const measurer = new TextMeasurer(registry);
          const layout = computeLabelLayout(exported.layers, exported.baseZoom, 1, measurer);
          scope.postMessage({ type: 'svg', id, svg: exportSVG(exported, layout, measurer, options) });
        } catch (error) {
          scope.postMessage({
            type: 'exportError',
            id,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      })();
      break;
    }
    case 'clear': {
      layers = [];
      labelToken += 1;
      labels = [];
      labelFits = {};
      lastPlacementKey = null;
      labelsOrigin = null;
      scene = null;
      camera = null;
      drawNow(null);
      break;
    }
    case 'draw': {
      camera = message.camera;
      drawNow(message.epoch);
      break;
    }
  }
});

// Tell the page the listener above exists; see `WorkerMessage`.
scope.postMessage({ type: 'ready' });
