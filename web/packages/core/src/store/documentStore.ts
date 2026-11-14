import { createLayer, materializeProject } from '../model/inheritance';
import type { LayerKind, LayerSnapshot } from '../model/layers';
import type { ProjectSnapshot } from '../model/project';

const MAX_UNDO_STEPS = 100;
const COALESCE_WINDOW_MS = 400;

export interface DocumentHistory {
  readonly present: ProjectSnapshot;
  readonly undoStack: readonly ProjectSnapshot[];
  readonly redoStack: readonly ProjectSnapshot[];
  readonly isDirty: boolean;
  readonly lastCoalesceKey: string | null;
  readonly lastEditTime: number;
}

export interface EditOptions {
  /**
   * Rapid edits sharing the same `coalesceKey` within 400 ms (such as dragging a
   * slider or colour field) merge into one undo step, matching `AppState.documentChanged()`.
   */
  coalesceKey?: string;
  now?: number;
}

/** Creates a fresh undo/redo history for a loaded project, materializing subtype styles. */
export function createDocumentHistory(project: ProjectSnapshot): DocumentHistory {
  return {
    present: materializeProject(project),
    undoStack: [],
    redoStack: [],
    isDirty: false,
    lastCoalesceKey: null,
    lastEditTime: 0,
  };
}

/** Applies a pure edit to the project, recording an undo step and marking the document edited. */
export function applyDocumentEdit(
  history: DocumentHistory,
  updater: (project: ProjectSnapshot) => ProjectSnapshot,
  options: EditOptions = {},
): DocumentHistory {
  const next = updater(history.present);
  if (next === history.present) return history;

  const now = options.now ?? Date.now();
  const key = options.coalesceKey ?? null;
  const shouldCoalesce =
    key !== null &&
    key === history.lastCoalesceKey &&
    now - history.lastEditTime <= COALESCE_WINDOW_MS &&
    history.undoStack.length > 0;

  const undoStack = shouldCoalesce
    ? history.undoStack
    : [...history.undoStack.slice(-(MAX_UNDO_STEPS - 1)), history.present];

  return {
    present: next,
    undoStack,
    redoStack: [],
    isDirty: true,
    lastCoalesceKey: key,
    lastEditTime: now,
  };
}

/** Steps back one edit in `undoStack`. */
export function undoDocument(history: DocumentHistory): DocumentHistory {
  if (history.undoStack.length === 0) return history;
  const previous = history.undoStack[history.undoStack.length - 1]!;
  return {
    present: previous,
    undoStack: history.undoStack.slice(0, -1),
    redoStack: [...history.redoStack, history.present],
    isDirty: true,
    lastCoalesceKey: null,
    lastEditTime: 0,
  };
}

/** Steps forward one edit in `redoStack`. */
export function redoDocument(history: DocumentHistory): DocumentHistory {
  if (history.redoStack.length === 0) return history;
  const next = history.redoStack[history.redoStack.length - 1]!;
  return {
    present: next,
    undoStack: [...history.undoStack, history.present],
    redoStack: history.redoStack.slice(0, -1),
    isDirty: true,
    lastCoalesceKey: null,
    lastEditTime: 0,
  };
}

/** Marks the current state as saved on disk while keeping undo history intact. */
export function markDocumentSaved(
  history: DocumentHistory,
  savedProject?: ProjectSnapshot,
): DocumentHistory {
  return {
    ...history,
    present: savedProject ?? history.present,
    isDirty: false,
    lastCoalesceKey: null,
  };
}

// MARK: - Layer helpers

export function updateProjectLayer(
  project: ProjectSnapshot,
  layerId: string,
  updater: (layer: LayerSnapshot) => LayerSnapshot,
): ProjectSnapshot {
  let changed = false;
  const layers = project.layers.map((layer) => {
    if (layer.id !== layerId) return layer;
    const next = updater(layer);
    if (next !== layer) changed = true;
    return next;
  });
  return changed ? { ...project, layers } : project;
}

/** Inserts a new layer at the top of the list (index 0 renders on top). */
export function addProjectLayer(
  project: ProjectSnapshot,
  kind: LayerKind,
  name?: string,
  id?: string,
): { project: ProjectSnapshot; layer: LayerSnapshot } {
  const layer = createLayer(kind, name, id);
  return {
    project: {
      ...project,
      layers: [layer, ...project.layers],
    },
    layer,
  };
}

export function removeProjectLayer(
  project: ProjectSnapshot,
  layerId: string,
): ProjectSnapshot {
  const layers = project.layers.filter((layer) => layer.id !== layerId);
  return layers.length === project.layers.length ? project : { ...project, layers };
}

/** Moves an item from `fromIndex` to `toIndex` within an array. */
export function moveItem<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex < 0 ||
    fromIndex >= items.length ||
    toIndex < 0 ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return [...items];
  }
  const copy = [...items];
  const [item] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, item!);
  return copy;
}

export function moveProjectLayer(
  project: ProjectSnapshot,
  fromIndex: number,
  toIndex: number,
): ProjectSnapshot {
  if (fromIndex === toIndex) return project;
  return {
    ...project,
    layers: moveItem(project.layers, fromIndex, toIndex),
  };
}
