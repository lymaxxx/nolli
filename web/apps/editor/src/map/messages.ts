import type {
  CameraPose,
  LayerSnapshot,
  RasterXYZSource,
} from '@nolli/core';

/** Main thread → render worker. */
export type MainMessage =
  | { type: 'init'; canvas: OffscreenCanvas }
  | { type: 'surface'; width: number; height: number; dpr: number }
  | { type: 'project'; layers: LayerSnapshot[]; baseZoom: number }
  | {
      type: 'view';
      showTiles: boolean;
      tileOpacity: number;
      source: RasterXYZSource;
    }
  | { type: 'clear' }
  | { type: 'draw'; camera: CameraPose; epoch: number };

/** Render worker → main thread. */
export type WorkerMessage =
  | {
      type: 'drawn';
      camera: CameraPose;
      /** The request this frame answers, or null for a tile-triggered redraw. */
      epoch: number | null;
      renderMs: number;
      featureCount: number;
      tileCount: number;
      missingTiles: number;
    }
  | { type: 'error'; message: string };
