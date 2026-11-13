import {
  loadProject,
  serializeProject,
  type CameraPose,
  type ProjectSnapshot,
} from '@nolli/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MapCanvas } from './map/MapCanvas';
import { TextSpike } from './TextSpike';
import {
  openProjectFile,
  saveProjectFile,
  type OpenedProjectFile,
  type SavedProjectFile,
} from './platform';
import { summarizeProject, type ProjectSummary } from './projectSummary';

interface Notice {
  kind: 'ok' | 'error';
  text: string;
}

function describeError(error: unknown): string {
  if (error instanceof SyntaxError) return 'This file is not valid JSON.';
  if (error instanceof Error && error.name === 'ZodError') {
    return 'This file does not match the Nolli project format.';
  }
  return error instanceof Error ? error.message : String(error);
}

function ProjectCard({
  file,
  project,
}: {
  file: SavedProjectFile;
  project: ProjectSnapshot;
}) {
  const summary: ProjectSummary = summarizeProject(project);
  return (
    <section className="project-card" aria-label="Open project">
      <header>
        <h2>{file.name}</h2>
        {file.path && (
          <p className="project-path" title={file.path}>
            {file.path}
          </p>
        )}
      </header>
      <p className="project-line">
        Version {summary.version} · {summary.layerCount} layers ·{' '}
        {summary.featureCount.toLocaleString()} features
      </p>
      <dl className="summary-grid">
        <div>
          <dt>Lines</dt>
          <dd>{summary.lineCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Polygons</dt>
          <dd>{summary.polygonCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Points</dt>
          <dd>{summary.pointCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Road sublayers</dt>
          <dd>{summary.roadSubLayerCount.toLocaleString()}</dd>
        </div>
      </dl>
      {summary.bounds && <p className="project-bounds">Bounds {summary.bounds}</p>}
    </section>
  );
}

/**
 * Milestone M3: the project shell opens a file and draws it on the live map.
 * The camera drives tiles, vectors and markers; layer and style editing
 * arrive with the later editor milestones.
 */
export function ProjectFiles() {
  const [project, setProject] = useState<ProjectSnapshot>();
  const [file, setFile] = useState<SavedProjectFile>();
  const [notice, setNotice] = useState<Notice>();
  const [busy, setBusy] = useState(false);
  const [showSpike, setShowSpike] = useState(false);
  const cameraRef = useRef<CameraPose | null>(null);

  const handleCameraChange = useCallback((camera: CameraPose) => {
    cameraRef.current = camera;
  }, []);

  const loadFile = useCallback(async (next: OpenedProjectFile) => {
    const loaded = loadProject(next.content);
    cameraRef.current = null;
    setProject(loaded);
    setFile({ name: next.name, path: next.path, handle: next.handle });
    setNotice({ kind: 'ok', text: `Opened ${next.name}.` });
  }, []);

  useEffect(() => {
    const desktop = window.nolliDesktop;
    if (!desktop) return;
    desktop.ready();
    return desktop.onOpenProject((event) => {
      if ('error' in event) {
        setNotice({ kind: 'error', text: event.error });
        return;
      }
      void loadFile(event.file).catch((error: unknown) => {
        setNotice({ kind: 'error', text: describeError(error) });
      });
    });
  }, [loadFile]);

  async function openProject() {
    setBusy(true);
    try {
      const next = await openProjectFile();
      if (next) await loadFile(next);
    } catch (error) {
      setNotice({ kind: 'error', text: describeError(error) });
    } finally {
      setBusy(false);
    }
  }

  async function saveProject() {
    if (!project || !file) return;
    setBusy(true);
    try {
      const camera = cameraRef.current;
      // The camera is part of the project format, as it is in the macOS app.
      const snapshot: ProjectSnapshot = camera
        ? {
            ...project,
            cameraLat: camera.centerLat,
            cameraLon: camera.centerLon,
            cameraZoom: camera.zoom,
            artboardRotation: camera.rotation,
          }
        : project;
      const saved = await saveProjectFile(serializeProject(snapshot), {
        name: file.name,
        path: file.path,
        handle: file.handle,
      });
      if (saved) {
        setFile({ ...file, ...saved });
        setNotice({ kind: 'ok', text: `Saved ${saved.name}.` });
      }
    } catch (error) {
      setNotice({ kind: 'error', text: describeError(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="workspace">
      <div className="workspace-map">
        <MapCanvas project={project ?? null} onCameraChange={handleCameraChange} />
      </div>

      <aside className="workspace-panel" aria-label="Project">
        <section className="shell-panel">
          <div className="shell-actions">
            <button type="button" className="primary" onClick={openProject} disabled={busy}>
              Open project…
            </button>
            <button type="button" onClick={saveProject} disabled={busy || !project}>
              Save as .nolli
            </button>
          </div>
          <p className="hint">
            Opens <code>.nolli</code> projects and legacy <code>.mapcraft</code> files. Saving
            always writes a version 7 <code>.nolli</code> file.
          </p>
          <p className="hint">
            Drag to pan, scroll to zoom, double-click to zoom in. Hold Option and drag, or
            pinch, to rotate.
          </p>
          {notice && (
            <p
              className={`notice ${notice.kind}`}
              role={notice.kind === 'error' ? 'alert' : 'status'}
            >
              {notice.text}
            </p>
          )}
        </section>

        {project && file ? (
          <ProjectCard file={file} project={project} />
        ) : (
          <p className="empty">No project open.</p>
        )}

        <section className="spike-toggle">
          <button type="button" className="link-button" onClick={() => setShowSpike(!showSpike)}>
            {showSpike ? 'Hide' : 'Show'} text-engine sample
          </button>
        </section>
        {showSpike && <TextSpike />}
      </aside>
    </main>
  );
}
