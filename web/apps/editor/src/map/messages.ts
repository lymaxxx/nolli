import type {
  BoundingBox,
  CameraPose,
  ProjectSnapshot,
  SvgExportOptions,
  LayerLabelFit,
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
      background: string | null;
      /** The area to outline on the map, or null for none. */
      area: BoundingBox | null;
      source: RasterXYZSource;
    }
  | {
      /** Font files for project fonts. Replaces any sent before; labels are placed again. */
      type: 'fonts';
      fonts: { family: string; style: string; data: ArrayBuffer }[];
    }
  | {
      /** Lays out and writes an SVG of `project`; answered by `svg` or `exportError` with the same id. */
      type: 'exportSvg';
      id: number;
      project: ProjectSnapshot;
      options: SvgExportOptions;
    }
  | { type: 'clear' }
  | { type: 'draw'; camera: CameraPose; epoch: number };

/** Render worker → main thread. */
export type WorkerMessage =
  /**
   * The worker's message listener is attached. The worker's script has a
   * top-level `await` (HarfBuzz's WebAssembly), and a message that arrives
   * before the listener exists is silently lost, so nothing is sent until this.
   */
  | { type: 'ready' }
  | {
      type: 'drawn';
      camera: CameraPose;
      /** The request this frame answers, or null for a tile-triggered redraw. */
      epoch: number | null;
      renderMs: number;
      featureCount: number;
      labelCount: number;
      /** How long placing the labels took, in milliseconds; 0 until they are placed. */
      labelMs: number;
      tileCount: number;
      missingTiles: number;
      labelFits: Record<string, LayerLabelFit>;
    }
  | { type: 'svg'; id: number; svg: string }
  | { type: 'exportError'; id: number; message: string }
  | { type: 'error'; message: string };
