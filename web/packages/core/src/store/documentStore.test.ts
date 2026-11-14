import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadProject } from '../project/project';
import {
  addProjectLayer,
  applyDocumentEdit,
  createDocumentHistory,
  markDocumentSaved,
  moveProjectLayer,
  redoDocument,
  removeProjectLayer,
  undoDocument,
  updateProjectLayer,
} from './documentStore';

const currentJSON = readFileSync(
  new URL('../project/fixtures/macos-v7.json', import.meta.url),
  'utf8',
);

describe('DocumentHistory undo/redo store', () => {
  it('records edits, coalesces rapid slider drags and undoes/redoes cleanly', () => {
    const project = loadProject(currentJSON);
    let history = createDocumentHistory(project);
    expect(history.isDirty).toBe(false);
    expect(history.undoStack).toHaveLength(0);

    // Rapid slider drag with same coalesceKey within 400ms -> 1 undo step
    history = applyDocumentEdit(
      history,
      (p) => ({ ...p, baseZoom: 16 }),
      { coalesceKey: 'baseZoom', now: 1000 },
    );
    history = applyDocumentEdit(
      history,
      (p) => ({ ...p, baseZoom: 18 }),
      { coalesceKey: 'baseZoom', now: 1200 },
    );
    expect(history.present.baseZoom).toBe(18);
    expect(history.undoStack).toHaveLength(1);
    expect(history.isDirty).toBe(true);

    // Distinct edit -> 2nd undo step
    history = applyDocumentEdit(history, (p) => ({ ...p, showNorthArrow: false }), { now: 2000 });
    expect(history.undoStack).toHaveLength(2);

    // Undo once -> restores showNorthArrow = true, baseZoom = 18
    history = undoDocument(history);
    expect(history.present.showNorthArrow).toBe(true);
    expect(history.present.baseZoom).toBe(18);
    expect(history.redoStack).toHaveLength(1);

    // Undo again -> restores original baseZoom = 17
    history = undoDocument(history);
    expect(history.present.baseZoom).toBe(17);

    // Redo -> back to baseZoom = 18
    history = redoDocument(history);
    expect(history.present.baseZoom).toBe(18);

    // Mark saved clears dirty flag
    history = markDocumentSaved(history);
    expect(history.isDirty).toBe(false);
  });

  it('adds, reorders, updates and removes layers', () => {
    const project = loadProject(currentJSON);
    const { project: withPark, layer: park } = addProjectLayer(
      project,
      'parks',
      'Parks',
      '00000000-0000-4000-8000-000000000088',
    );
    expect(withPark.layers[0]!.id).toBe(park.id);
    expect(withPark.layers).toHaveLength(2);

    const moved = moveProjectLayer(withPark, 0, 1);
    expect(moved.layers[1]!.id).toBe(park.id);

    const renamed = updateProjectLayer(moved, park.id, (l) => ({ ...l, name: 'Green Space' }));
    expect(renamed.layers[1]!.name).toBe('Green Space');

    const removed = removeProjectLayer(renamed, park.id);
    expect(removed.layers).toHaveLength(1);
  });
});
