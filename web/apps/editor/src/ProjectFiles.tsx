import {
  addProjectLayer,
  applyColorScheme,
  applyDocumentEdit,
  applyTextStyleToLabel,
  captureColorScheme,
  captureTextStyleFromLabel,
  createDocumentHistory,
  fontsUsed,
  loadProject,
  markDocumentSaved,
  moveProjectLayer,
  redoDocument,
  removeProjectLayer,
  serializeProject,
  syncSubLabelStyles,
  undoDocument,
  updateProjectLayer,
  type CameraPose,
  type CodableColor,
  type DocumentHistory,
  type FontRequest,
  type LayerKind,
  type LayerLabelFit,
  type LayerSnapshot,
  type MapColorScheme,
  type ProjectSnapshot,
} from '@nolli/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  canReadInstalledFonts,
  deleteSavedFont,
  fontKey,
  installedFontsAllowed,
  loadSavedFonts,
  readInstalledFonts,
  saveFont,
  type FontEntry,
} from './fontStore';
import { MapCanvas } from './map/MapCanvas';
import {
  openProjectFile,
  saveProjectFile,
  type OpenedProjectFile,
  type SavedProjectFile,
} from './platform';
import { summarizeProject } from './projectSummary';
import type { ColorLibraryActions } from './style/ColorWell';
import { LayersPanel } from './style/LayersPanel';
import { StyleInspector } from './style/StyleInspector';
import { TextSpike } from './TextSpike';

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

export function ProjectFiles() {
  const [history, setHistory] = useState<DocumentHistory | null>(null);
  const [projectSession, setProjectSession] = useState(0);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [panelsHidden, setPanelsHidden] = useState(false);
  const [file, setFile] = useState<SavedProjectFile>();
  const [notice, setNotice] = useState<Notice>();
  const [busy, setBusy] = useState(false);
  const [showSpike, setShowSpike] = useState(false);
  const [liveCamera, setLiveCamera] = useState<CameraPose | null>(null);
  const [labelFits, setLabelFits] = useState<Record<string, LayerLabelFit>>({});
  const cameraRef = useRef<CameraPose | null>(null);
  const [fontEntries, setFontEntries] = useState<FontEntry[]>([]);

  const project = history?.present ?? null;
  const requests = useMemo<FontRequest[]>(
    () => (project ? fontsUsed(project.layers) : []),
    [project],
  );

  const handleCameraChange = useCallback((camera: CameraPose) => {
    cameraRef.current = camera;
    setLiveCamera(camera);
  }, []);

  /** Adds or replaces font entries; a later entry for the same face wins. */
  const addFonts = useCallback((added: FontEntry[]) => {
    setFontEntries((current) => {
      const byKey = new Map(
        current.map((entry) => [fontKey(entry.family, entry.style), entry]),
      );
      for (const entry of added) byKey.set(fontKey(entry.family, entry.style), entry);
      return [...byKey.values()];
    });
  }, []);

  useEffect(() => {
    void loadSavedFonts().then(addFonts);
  }, [addFonts]);

  const findInstalledFonts = useCallback(async () => {
    setBusy(true);
    try {
      const found = await readInstalledFonts(requests);
      addFonts(found);
      setNotice({
        kind: found.length > 0 ? 'ok' : 'error',
        text:
          found.length > 0
            ? `Found ${found.length} installed font file${found.length === 1 ? '' : 's'}.`
            : "None of this project's fonts are installed on this computer.",
      });
    } catch (error) {
      setNotice({
        kind: 'error',
        text: `Installed fonts could not be read: ${describeError(error)}`,
      });
    } finally {
      setBusy(false);
    }
  }, [addFonts, requests]);

  useEffect(() => {
    if (requests.length === 0 || !canReadInstalledFonts()) return;
    let cancelled = false;
    void installedFontsAllowed().then((allowed) => {
      if (allowed && !cancelled) {
        void readInstalledFonts(requests).then((found) => !cancelled && addFonts(found));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [requests, addFonts]);

  const chooseFontFile = useCallback(
    async (request: FontRequest, chosen: File) => {
      const entry: FontEntry = {
        family: request.family,
        style: request.style,
        source: 'file',
        data: await chosen.arrayBuffer(),
      };
      addFonts([entry]);
      await saveFont(entry);
    },
    [addFonts],
  );

  const removeFontFile = useCallback(async (entry: FontEntry) => {
    setFontEntries((current) => current.filter((candidate) => candidate !== entry));
    await deleteSavedFont(entry.family, entry.style);
  }, []);

  const loadFile = useCallback(async (next: OpenedProjectFile) => {
    const loaded = loadProject(next.content);
    cameraRef.current = null;
    setLiveCamera(null);
    setLabelFits({});
    const nextHistory = createDocumentHistory(loaded);
    setHistory(nextHistory);
    setProjectSession((s) => s + 1);
    const defaultLayer =
      nextHistory.present.layers.find((l) => l.kind === 'roads') ??
      nextHistory.present.layers[0];
    setSelectedLayerId(defaultLayer?.id ?? null);
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

  const editProject = useCallback(
    (updater: (p: ProjectSnapshot) => ProjectSnapshot, coalesceKey?: string) => {
      setHistory((current) =>
        current ? applyDocumentEdit(current, updater, { coalesceKey }) : current,
      );
    },
    [],
  );

  const editLayer = useCallback(
    (
      layerId: string,
      updater: (l: LayerSnapshot) => LayerSnapshot,
      coalesceKey?: string,
    ) => {
      editProject((p) => updateProjectLayer(p, layerId, updater), coalesceKey);
    },
    [editProject],
  );

  const handleUndo = useCallback(() => {
    setHistory((current) => (current ? undoDocument(current) : current));
  }, []);

  const handleRedo = useCallback(() => {
    setHistory((current) => (current ? redoDocument(current) : current));
  }, []);

  const openProject = useCallback(async () => {
    setBusy(true);
    try {
      const next = await openProjectFile();
      if (next) await loadFile(next);
    } catch (error) {
      setNotice({ kind: 'error', text: describeError(error) });
    } finally {
      setBusy(false);
    }
  }, [loadFile]);

  const saveProject = useCallback(async () => {
    if (!project || !file) return;
    setBusy(true);
    try {
      const camera = cameraRef.current;
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
        setHistory((current) => (current ? markDocumentSaved(current, snapshot) : current));
        setNotice({ kind: 'ok', text: `Saved ${saved.name}.` });
      }
    } catch (error) {
      setNotice({ kind: 'error', text: describeError(error) });
    } finally {
      setBusy(false);
    }
  }, [file, project]);

  // Global keyboard shortcuts (Undo, Redo, Save, Escape -> Map)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditingInput =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        Boolean(target?.isContentEditable);

      if (event.key === 'Escape' && !isEditingInput) {
        setSelectedLayerId(null);
        return;
      }

      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;

      if (event.key.toLowerCase() === 'z' && !isEditingInput) {
        event.preventDefault();
        if (event.shiftKey) handleRedo();
        else handleUndo();
      } else if (event.key.toLowerCase() === 'y' && !isEditingInput) {
        event.preventDefault();
        handleRedo();
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveProject();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleRedo, handleUndo, saveProject]);

  const colorLibrary = useMemo<ColorLibraryActions>(
    () => ({
      swatches: project?.colorSwatches ?? [],
      schemes: project?.colorSchemes ?? [],
      onAddSwatch: (color: CodableColor) => {
        editProject((p) => ({
          ...p,
          colorSwatches: [...(p.colorSwatches ?? []), { ...color }],
        }));
      },
      onRemoveSwatch: (index: number) => {
        editProject((p) => ({
          ...p,
          colorSwatches: (p.colorSwatches ?? []).filter((_, idx) => idx !== index),
        }));
      },
      onSaveScheme: (name: string) => {
        editProject((p) => {
          const scheme = captureColorScheme(
            p,
            name,
            `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, '0').slice(-12)}`,
          );
          return {
            ...p,
            colorSchemes: [...(p.colorSchemes ?? []), scheme],
          };
        });
      },
      onApplyScheme: (scheme: MapColorScheme) => {
        editProject((p) => applyColorScheme(p, scheme));
      },
      onDeleteScheme: (id: string) => {
        editProject((p) => ({
          ...p,
          colorSchemes: (p.colorSchemes ?? []).filter((scheme) => scheme.id !== id),
        }));
      },
    }),
    [editProject, project?.colorSchemes, project?.colorSwatches],
  );

  const handleSaveTextStyle = useCallback(
    (layerId: string, name: string) => {
      editProject((p) => {
        const layer = p.layers.find((l) => l.id === layerId);
        if (!layer) return p;
        const preset = captureTextStyleFromLabel(name, layer.labelStyle);
        return {
          ...p,
          textStyles: [...p.textStyles, preset],
          layers: p.layers.map((l) =>
            l.id === layerId
              ? syncSubLabelStyles({
                  ...l,
                  labelStyle: applyTextStyleToLabel(l.labelStyle, preset),
                })
              : l,
          ),
        };
      });
    },
    [editProject],
  );

  const handleDeleteTextStyle = useCallback(
    (id: string) => {
      editProject((p) => ({
        ...p,
        textStyles: p.textStyles.filter((ts) => ts.id !== id),
      }));
    },
    [editProject],
  );

  const summary = useMemo(() => (project ? summarizeProject(project) : null), [project]);
  const canUndo = (history?.undoStack.length ?? 0) > 0;
  const canRedo = (history?.redoStack.length ?? 0) > 0;
  const isDirty = history?.isDirty ?? false;

  return (
    <div className="app-shell">
      {/* Tier 1: Titlebar (40 px) */}
      <header className="titlebar" aria-label="Application bar">
        <div className="titlebar-left">
          <div className="nolli-brand">
            <span className="nolli-monogram" aria-hidden="true">
              N
            </span>
            <span className="nolli-wordmark">Nolli</span>
          </div>

          <div className="project-tabs" role="tablist" aria-label="Open projects">
            <div
              role="tab"
              aria-selected="true"
              className="project-tab active"
              title={file?.path ?? file?.name ?? 'Untitled project'}
            >
              <span className="project-tab-name">{file?.name ?? 'No project open'}</span>
              {project && (
                <span
                  className={`dirty-dot${isDirty ? ' edited' : ' saved'}`}
                  title={isDirty ? 'Edited (unsaved changes)' : 'Saved'}
                  data-testid="project-status-dot"
                />
              )}
            </div>
          </div>
        </div>

        <div className="titlebar-right">
          <button
            type="button"
            className="link-button"
            onClick={() => setShowSpike((current) => !current)}
          >
            {showSpike ? 'Hide' : 'Show'} text-engine sample
          </button>
        </div>
      </header>

      {/* Tier 2: Toolbar (52 px) */}
      <div className="toolbar" role="toolbar" aria-label="Map toolbar">
        <div className="toolbar-zone toolbar-left">
          <button
            type="button"
            className="toolbar-icon-btn"
            aria-pressed={panelsHidden}
            aria-label={panelsHidden ? 'Show panels' : 'Hide panels'}
            title={panelsHidden ? 'Show side panels' : 'Hide side panels'}
            onClick={() => setPanelsHidden((current) => !current)}
          >
            ◫
          </button>
          <button
            type="button"
            className="toolbar-icon-btn"
            disabled={!canUndo}
            aria-label="Undo"
            title="Undo (⌘Z)"
            onClick={handleUndo}
          >
            ↶
          </button>
          <button
            type="button"
            className="toolbar-icon-btn"
            disabled={!canRedo}
            aria-label="Redo"
            title="Redo (⌘⇧Z)"
            onClick={handleRedo}
          >
            ↷
          </button>
        </div>

        <div className="toolbar-zone toolbar-center">
          <nav className="phase-tabs" aria-label="Workflow phases">
            <button type="button" className="phase-tab" disabled title="Area phase (M6)">
              Area
            </button>
            <button type="button" className="phase-tab active" aria-current="page">
              Style
            </button>
            <button type="button" className="phase-tab" disabled title="Signs phase (M8)">
              Signs
            </button>
            <button type="button" className="phase-tab" disabled title="Export phase (M9)">
              Export
            </button>
          </nav>
        </div>

        <div className="toolbar-zone toolbar-right">
          <button
            type="button"
            className="primary"
            onClick={() => void openProject()}
            disabled={busy}
          >
            Open project…
          </button>
          <button
            type="button"
            onClick={() => void saveProject()}
            disabled={busy || !project}
          >
            Save as .nolli
          </button>
        </div>
      </div>

      {/* Main 3-column workspace */}
      <main className={`workspace${panelsHidden ? ' panels-hidden' : ''}`}>
        {!panelsHidden && (
          <LayersPanel
            project={project}
            selectedLayerId={selectedLayerId}
            onSelectLayer={setSelectedLayerId}
            onToggleLayerVisible={(layerId) =>
              editLayer(layerId, (l) => ({ ...l, isVisible: !l.isVisible }))
            }
            onRenameLayer={(layerId, name) => editLayer(layerId, (l) => ({ ...l, name }))}
            onAddLayer={(kind: LayerKind) => {
              let createdId: string | null = null;
              editProject((p) => {
                const { project: next, layer } = addProjectLayer(p, kind);
                createdId = layer.id;
                return next;
              });
              if (createdId) setSelectedLayerId(createdId);
            }}
            onRemoveLayer={(layerId) => {
              editProject((p) => removeProjectLayer(p, layerId));
              if (selectedLayerId === layerId) setSelectedLayerId(null);
            }}
            onMoveLayer={(fromIndex, toIndex) => {
              editProject((p) => moveProjectLayer(p, fromIndex, toIndex));
            }}
            labelFits={labelFits}
            fontRequests={requests}
            fontEntries={fontEntries}
            fontsBusy={busy}
            onFindInstalledFonts={() => void findInstalledFonts()}
            onChooseFontFile={(request, chosen) => void chooseFontFile(request, chosen)}
            onRemoveFontFile={(entry) => void removeFontFile(entry)}
            onSaveScheme={colorLibrary.onSaveScheme}
            onApplyScheme={colorLibrary.onApplyScheme}
            onDeleteScheme={colorLibrary.onDeleteScheme}
            onDeleteTextStyle={handleDeleteTextStyle}
          />
        )}

        <div className="workspace-map">
          <MapCanvas
            project={project}
            projectSession={projectSession}
            fonts={fontEntries}
            onCameraChange={handleCameraChange}
            onLabelFitsChange={setLabelFits}
          />
          {showSpike && (
            <div className="spike-overlay" role="dialog" aria-label="Text-engine sample">
              <TextSpike />
            </div>
          )}
        </div>

        {!panelsHidden && (
          <StyleInspector
            project={project}
            selectedLayerId={selectedLayerId}
            liveZoom={liveCamera?.zoom ?? project?.baseZoom ?? 15}
            liveRotation={liveCamera?.rotation ?? project?.artboardRotation ?? 0}
            labelFits={labelFits}
            colorLibrary={colorLibrary}
            onEditProject={editProject}
            onEditLayer={editLayer}
            onSaveTextStyle={handleSaveTextStyle}
          />
        )}
      </main>

      {/* Bottom statusbar (24 px) */}
      <footer className="statusbar" aria-label="Status bar">
        <div className="statusbar-left">
          {project && summary ? (
            <span>
              Zoom {(liveCamera?.zoom ?? project.baseZoom).toFixed(1)} · Version {summary.version} ·{' '}
              {summary.layerCount} layers · {summary.featureCount.toLocaleString()} features
              {summary.bounds ? ` · Bounds ${summary.bounds}` : ''}
            </span>
          ) : (
            <span>No project open</span>
          )}
        </div>
        <div className="statusbar-right">
          {notice && (
            <span
              className={`notice ${notice.kind}`}
              role={notice.kind === 'error' ? 'alert' : 'status'}
            >
              {notice.text}
            </span>
          )}
        </div>
      </footer>
    </div>
  );
}
