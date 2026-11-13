import {
  compileScene,
  OSM_STANDARD,
  projectionOf,
  type CameraPose,
  type RasterXYZSource,
  type Scene,
} from '@nolli/core';
import { drawScene } from './drawScene';
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
let camera: CameraPose | null = null;
let viewport = { width: 0, height: 0 };
let dpr = 1;
let source: RasterXYZSource = OSM_STANDARD;
let showTiles = true;
let tileOpacity = 1;
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
  if (scene) drawScene(ctx, scene, projection, metrics);

  scope.postMessage({
    type: 'drawn',
    camera,
    epoch,
    renderMs: performance.now() - started,
    featureCount: scene?.featureCount ?? 0,
    tileCount: tiles.tileCount,
    missingTiles: tiles.missingTiles,
  });
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
        drawNow(null);
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
      source = message.source;
      loader.setSource(source);
      scheduleRedraw();
      break;
    }
    case 'clear': {
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
