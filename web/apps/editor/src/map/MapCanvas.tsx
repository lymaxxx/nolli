import {
  cameraForProject,
  cssColor,
  fitBounds,
  OSM_STANDARD,
  panBy,
  projectionOf,
  relativeScreenTransform,
  rotateAround,
  rotateBy,
  sameCamera,
  toCssMatrix,
  zoomAround,
  type CameraPose,
  type LayerLabelFit,
  type ProjectSnapshot,
  type SvgExportOptions,
} from '@nolli/core';
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { MainMessage, WorkerMessage } from './messages';
import { compensateOverscan, surfaceMetrics } from './surface';

interface MapStatus {
  zoom: number;
  rotation: number;
  renderMs: number;
  featureCount: number;
  labelCount: number;
  labelMs: number;
  tileCount: number;
  missingTiles: number;
}

interface PointerPosition {
  x: number;
  y: number;
}

/**
 * Milestone M3: the live map. The camera is the only source of truth; the
 * worker draws tiles and vectors through one artwork transform and transfers
 * the finished bitmap back as the OffscreenCanvas itself. During a gesture the
 * bitmap is moved by a CSS matrix until the next frame arrives.
 */
/** Writes an SVG of a project. It runs in the render worker, so the page stays responsive. */
export type SvgExporter = (project: ProjectSnapshot, options: SvgExportOptions) => Promise<string>;

export function MapCanvas({
  project,
  projectSession = 0,
  fonts = [],
  onCameraChange,
  onLabelFitsChange,
  exporterRef,
}: {
  project: ProjectSnapshot | null;
  /** Bumped when a new project file is opened, so style edits do not reset the camera. */
  projectSession?: number;
  /** Font files for project fonts; road names are set in these where they match. */
  fonts?: readonly { family: string; style: string; data: ArrayBuffer }[];
  onCameraChange?: (camera: CameraPose) => void;
  onLabelFitsChange?: (fits: Record<string, LayerLabelFit>) => void;
  /** Filled with a function that exports an SVG through the map's worker. */
  exporterRef?: MutableRefObject<SvgExporter | null>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);
  /** Posts to the worker, holding messages until it says it is listening. */
  const readyRef = useRef<() => void>(() => {});
  const postRef = useRef<(message: MainMessage, transfer?: Transferable[]) => void>(() => {});
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const projectRef = useRef<ProjectSnapshot | null>(project);
  const sessionRef = useRef<number>(-1);
  const lastArtboardRotationRef = useRef<number | null>(null);
  const cameraRef = useRef<CameraPose | null>(null);
  const renderedRef = useRef<CameraPose | null>(null);
  const viewportRef = useRef({ width: 0, height: 0 });
  const inFlightRef = useRef(false);
  const queuedRef = useRef(false);
  const epochRef = useRef(0);
  const onCameraChangeRef = useRef(onCameraChange);
  const onLabelFitsChangeRef = useRef(onLabelFitsChange);
  const exportsRef = useRef(new Map<number, { resolve: (svg: string) => void; reject: (error: Error) => void }>());
  const exportIdRef = useRef(0);
  const [status, setStatus] = useState<MapStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onCameraChangeRef.current = onCameraChange;
  }, [onCameraChange]);

  useEffect(() => {
    onLabelFitsChangeRef.current = onLabelFitsChange;
  }, [onLabelFitsChange]);

  const applyTransform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rendered = renderedRef.current;
    const current = cameraRef.current;
    const viewport = viewportRef.current;

    if (
      !rendered ||
      !current ||
      viewport.width <= 0 ||
      viewport.height <= 0 ||
      sameCamera(rendered, current, 1e-9)
    ) {
      canvas.style.transform = 'none';
      return;
    }

    const transform = relativeScreenTransform(
      projectionOf(rendered, viewport),
      projectionOf(current, viewport),
    );
    canvas.style.transform = toCssMatrix(
      compensateOverscan(transform, surfaceMetrics(viewport, 1)),
    );
  }, []);

  const requestDraw = useCallback(() => {
    const worker = workerRef.current;
    const camera = cameraRef.current;
    const viewport = viewportRef.current;
    if (!worker || !camera || viewport.width <= 0 || viewport.height <= 0) return;
    if (inFlightRef.current) {
      queuedRef.current = true;
      return;
    }

    inFlightRef.current = true;
    const epoch = (epochRef.current += 1);
    const message: MainMessage = { type: 'draw', camera, epoch };
    postRef.current(message);
  }, []);

  const updateCamera = useCallback(
    (camera: CameraPose) => {
      cameraRef.current = camera;
      onCameraChangeRef.current?.(camera);
      applyTransform();
      requestDraw();
    },
    [applyTransform, requestDraw],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    setError(null);
    const canvas = document.createElement('canvas');
    canvas.className = 'map-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);
    canvasRef.current = canvas;

    let worker: Worker;
    try {
      const offscreen = canvas.transferControlToOffscreen();
      worker = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      let ready = false;
      const waiting: Array<[MainMessage, Transferable[] | undefined]> = [];
      postRef.current = (message, transfer) => {
        if (ready) worker.postMessage(message, transfer ?? []);
        else waiting.push([message, transfer]);
      };
      readyRef.current = () => {
        ready = true;
        for (const [message, transfer] of waiting.splice(0)) worker.postMessage(message, transfer ?? []);
      };
      const init: MainMessage = { type: 'init', canvas: offscreen };
      postRef.current(init, [offscreen]);
    } catch {
      queueMicrotask(() => setError('This browser cannot create the offscreen map canvas.'));
      canvas.remove();
      canvasRef.current = null;
      return;
    }

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === 'ready') {
        readyRef.current();
        return;
      }
      if (message.type === 'svg' || message.type === 'exportError') {
        const pending = exportsRef.current.get(message.id);
        exportsRef.current.delete(message.id);
        if (message.type === 'svg') pending?.resolve(message.svg);
        else pending?.reject(new Error(message.message));
        return;
      }
      if (message.type === 'error') {
        setError(message.message);
        inFlightRef.current = false;
        return;
      }

      if (message.epoch !== null) inFlightRef.current = false;
      renderedRef.current = message.camera;
      applyTransform();
      setError(null);
      setStatus({
        zoom: message.camera.zoom,
        rotation: message.camera.rotation,
        renderMs: message.renderMs,
        featureCount: message.featureCount,
        labelCount: message.labelCount,
        labelMs: message.labelMs,
        tileCount: message.tileCount,
        missingTiles: message.missingTiles,
      });
      onLabelFitsChangeRef.current?.(message.labelFits);

      const current = cameraRef.current;
      if (current && !sameCamera(message.camera, current)) {
        queuedRef.current = false;
        requestDraw();
      } else if (queuedRef.current) {
        queuedRef.current = false;
        requestDraw();
      }
    };
    worker.onerror = (event) => {
      setError(event.message || 'The map renderer stopped.');
      inFlightRef.current = false;
    };

    const applySurface = () => {
      const rect = host.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width < 1 || height < 1) return;

      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2.5));
      viewportRef.current = { width, height };
      const metrics = surfaceMetrics({ width, height }, dpr);
      canvas.style.width = `${metrics.cssWidth}px`;
      canvas.style.height = `${metrics.cssHeight}px`;
      canvas.style.left = `${-metrics.offsetX}px`;
      canvas.style.top = `${-metrics.offsetY}px`;
      renderedRef.current = null;
      canvas.style.transform = 'none';

      const message: MainMessage = { type: 'surface', width, height, dpr };
      postRef.current(message);
      if (!cameraRef.current && projectRef.current) {
        const camera = cameraForProject(projectRef.current);
        cameraRef.current = camera;
        onCameraChangeRef.current?.(camera);
      }
      requestDraw();
    };

    const observer = new ResizeObserver(applySurface);
    observer.observe(host);
    applySurface();
    window.addEventListener('resize', applySurface);

    // Gestures ------------------------------------------------------------
    const pointers = new Map<number, PointerPosition>();
    let mode: 'pan' | 'rotate' | null = null;
    let lastPoint: PointerPosition = { x: 0, y: 0 };
    let lastAngle = 0;
    let pinch: { distance: number; angle: number; mid: PointerPosition } | null = null;

    const localPoint = (event: { clientX: number; clientY: number }): PointerPosition => {
      const rect = host.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const angleFromCenter = (point: PointerPosition): number => {
      const viewport = viewportRef.current;
      return (
        (Math.atan2(point.y - viewport.height / 2, point.x - viewport.width / 2) * 180) /
        Math.PI
      );
    };

    const firstTwoPointers = (): [PointerPosition, PointerPosition] | null => {
      const values = [...pointers.values()];
      const first = values[0];
      const second = values[1];
      return first && second ? [first, second] : null;
    };

    const pinchState = (): { distance: number; angle: number; mid: PointerPosition } | null => {
      const pair = firstTwoPointers();
      if (!pair) return null;
      const [first, second] = pair;
      return {
        distance: Math.hypot(second.x - first.x, second.y - first.y),
        angle: (Math.atan2(second.y - first.y, second.x - first.x) * 180) / Math.PI,
        mid: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
      };
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const point = localPoint(event);
      pointers.set(event.pointerId, point);
      host.setPointerCapture(event.pointerId);
      host.classList.add('dragging');

      if (pointers.size === 1) {
        mode = event.altKey ? 'rotate' : 'pan';
        lastPoint = point;
        lastAngle = angleFromCenter(point);
        host.classList.toggle('rotating', mode === 'rotate');
      } else if (pointers.size === 2) {
        mode = null;
        pinch = pinchState();
      }
      event.preventDefault();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      const point = localPoint(event);
      pointers.set(event.pointerId, point);

      const camera = cameraRef.current;
      if (!camera) return;
      const viewport = viewportRef.current;

      if (pointers.size >= 2) {
        const current = pinchState();
        if (!current) return;
        if (pinch && pinch.distance > 0 && current.distance > 0) {
          let next = panBy(
            camera,
            current.mid.x - pinch.mid.x,
            current.mid.y - pinch.mid.y,
            viewport,
          );
          next = zoomAround(
            next,
            next.zoom + Math.log2(current.distance / pinch.distance),
            current.mid,
            viewport,
          );
          let rotationDelta = current.angle - pinch.angle;
          rotationDelta = ((rotationDelta + 540) % 360) - 180;
          if (Math.abs(rotationDelta) > 0.05) {
            // Screen angles grow clockwise; camera positive rotation is counter-clockwise.
            next = rotateAround(next, -rotationDelta, current.mid, viewport);
          }
          updateCamera(next);
        }
        pinch = current;
      } else if (mode === 'rotate') {
        const angle = angleFromCenter(point);
        updateCamera(rotateBy(camera, lastAngle - angle));
        lastAngle = angle;
        lastPoint = point;
      } else if (mode === 'pan') {
        updateCamera(panBy(camera, point.x - lastPoint.x, point.y - lastPoint.y, viewport));
        lastPoint = point;
      }
      event.preventDefault();
    };

    const endPointer = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      pinch = null;

      if (pointers.size === 1) {
        const pair = firstTwoPointers();
        if (pair) {
          mode = 'pan';
          lastPoint = pair[0];
          lastAngle = angleFromCenter(pair[0]);
        }
      } else if (pointers.size === 0) {
        mode = null;
        host.classList.remove('dragging', 'rotating');
        requestDraw();
      }
    };

    const onWheel = (event: WheelEvent) => {
      const camera = cameraRef.current;
      if (!camera) return;
      event.preventDefault();
      const viewport = viewportRef.current;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1;
      const delta = event.deltaY * unit;
      const factor = event.ctrlKey || event.metaKey ? 0.01 : 0.0015;
      updateCamera(
        zoomAround(camera, camera.zoom - delta * factor, localPoint(event), viewport),
      );
    };

    const onDoubleClick = (event: MouseEvent) => {
      const camera = cameraRef.current;
      if (!camera) return;
      updateCamera(
        zoomAround(
          camera,
          camera.zoom + 1,
          localPoint(event),
          viewportRef.current,
        ),
      );
    };

    host.addEventListener('pointerdown', onPointerDown);
    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerup', endPointer);
    host.addEventListener('pointercancel', endPointer);
    host.addEventListener('lostpointercapture', endPointer);
    host.addEventListener('wheel', onWheel, { passive: false });
    host.addEventListener('dblclick', onDoubleClick);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', applySurface);
      host.removeEventListener('pointerdown', onPointerDown);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerup', endPointer);
      host.removeEventListener('pointercancel', endPointer);
      host.removeEventListener('lostpointercapture', endPointer);
      host.removeEventListener('wheel', onWheel);
      host.removeEventListener('dblclick', onDoubleClick);
      worker.terminate();
      workerRef.current = null;
      canvas.remove();
      canvasRef.current = null;
      inFlightRef.current = false;
      queuedRef.current = false;
    };
  }, [applyTransform, requestDraw, updateCamera]);

  useEffect(() => {
    projectRef.current = project;
    const worker = workerRef.current;
    if (!worker) return;

    if (!project) {
      sessionRef.current = -1;
      lastArtboardRotationRef.current = null;
      cameraRef.current = null;
      renderedRef.current = null;
      if (canvasRef.current) canvasRef.current.style.transform = 'none';
      postRef.current({ type: 'clear' } satisfies MainMessage);
      return;
    }

    if (sessionRef.current !== projectSession || !cameraRef.current) {
      sessionRef.current = projectSession;
      lastArtboardRotationRef.current = project.artboardRotation;
      const camera = cameraForProject(project);
      cameraRef.current = camera;
      onCameraChangeRef.current?.(camera);
      renderedRef.current = null;
      if (canvasRef.current) canvasRef.current.style.transform = 'none';
    } else if (lastArtboardRotationRef.current !== project.artboardRotation) {
      lastArtboardRotationRef.current = project.artboardRotation;
      const delta = project.artboardRotation - cameraRef.current.rotation;
      if (Math.abs(delta) > 1e-4) {
        const nextCamera = rotateBy(cameraRef.current, delta);
        cameraRef.current = nextCamera;
        onCameraChangeRef.current?.(nextCamera);
      }
    }

    const background =
      project.artboardBackgroundEnabled && project.artboardBackground
        ? cssColor(project.artboardBackground)
        : null;

    postRef.current({
      type: 'project',
      layers: project.layers,
      baseZoom: project.baseZoom,
    } satisfies MainMessage);
    postRef.current({
      type: 'view',
      showTiles: project.settings.showTileBackground,
      tileOpacity: project.settings.tileOpacity,
      background,
      source: OSM_STANDARD,
    } satisfies MainMessage);
    requestDraw();
  }, [project, projectSession, requestDraw]);

  useEffect(() => {
    if (!exporterRef) return;
    const pendingExports = exportsRef.current;
    exporterRef.current = (exported, options) =>
      new Promise<string>((resolve, reject) => {
        exportIdRef.current += 1;
        const id = exportIdRef.current;
        pendingExports.set(id, { resolve, reject });
        postRef.current({ type: 'exportSvg', id, project: exported, options } satisfies MainMessage);
      });
    return () => {
      exporterRef.current = null;
      for (const pending of pendingExports.values()) pending.reject(new Error('The map was closed.'));
      pendingExports.clear();
    };
  }, [exporterRef]);

  // Send font files to the worker. Each send carries copies, so the page keeps its own bytes.
  useEffect(() => {
    const copies = fonts.map((font) => ({ family: font.family, style: font.style, data: font.data.slice(0) }));
    postRef.current(
      { type: 'fonts', fonts: copies } satisfies MainMessage,
      copies.map((font) => font.data),
    );
  }, [fonts]);

  const zoomBy = (delta: number) => {
    const camera = cameraRef.current;
    const viewport = viewportRef.current;
    if (!camera || viewport.width <= 0) return;
    updateCamera(
      zoomAround(camera, camera.zoom + delta, {
        x: viewport.width / 2,
        y: viewport.height / 2,
      }, viewport),
    );
  };

  const fitProject = () => {
    const camera = cameraRef.current;
    const bounds = projectRef.current?.boundingBox;
    const viewport = viewportRef.current;
    if (!camera || !bounds || viewport.width <= 0) return;
    updateCamera(fitBounds(camera, bounds, viewport, 32));
  };

  const resetNorth = () => {
    const camera = cameraRef.current;
    if (camera) updateCamera(rotateBy(camera, -camera.rotation));
  };

  const showTiles = project?.settings.showTileBackground ?? false;

  return (
    <div className="map-frame">
      <div className="map-host" ref={hostRef} aria-label="Map" />
      <div className="map-hud">
        {project && status ? (
          <>
            <span data-testid="map-status">
              Z {status.zoom.toFixed(2)} · {Math.round(status.rotation)}°
            </span>
            <span className="map-perf">
              {status.featureCount.toLocaleString()} features · {status.labelCount.toLocaleString()} labels ·{' '}
              {status.renderMs.toFixed(0)} ms
              {status.missingTiles > 0 ? ` · ${status.missingTiles} tiles loading` : ''}
            </span>
          </>
        ) : (
          <span>{project ? 'Preparing map…' : 'No project open'}</span>
        )}
      </div>
      <div className="map-controls" aria-label="Map controls">
        <button type="button" onClick={() => zoomBy(1)} title="Zoom in" aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomBy(-1)} title="Zoom out" aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={fitProject} title="Fit project" disabled={!project?.boundingBox}>
          Fit
        </button>
        <button type="button" onClick={resetNorth} title="Reset north" aria-label="Reset north">
          N
        </button>
      </div>
      {showTiles && <p className="map-attribution">© OpenStreetMap contributors</p>}
      {project?.showNorthArrow && (
        <div
          className={`north-arrow north-arrow-${project.northArrowPosition}`}
          data-testid="north-arrow"
          title="North arrow"
          style={{ transform: `rotate(${-(status?.rotation ?? 0)}deg)` }}
        >
          <span>N</span>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M8 2L12.5 13L8 10.5L3.5 13L8 2Z" fill="currentColor" />
          </svg>
        </div>
      )}
      {error && (
        <p className="map-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
