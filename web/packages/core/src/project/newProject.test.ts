import { describe, expect, it } from 'vitest';
import type { FetchResult } from '../data/overpass';
import { createLayer } from '../model/inheritance';
import { loadProject, serializeProject } from './project';
import { applyFetchedLayer, createEmptyProject, FETCH_KINDS, setProjectArea } from './newProject';

const area = { minLat: 54.65, minLon: -2.77, maxLat: 54.67, maxLon: -2.73 };
const data: FetchResult = {
  lines: [{ id: 1, tags: { highway: 'path' }, coordinates: [[-2.75, 54.66], [-2.74, 54.66]] }],
  polygons: [],
  points: [],
};

describe('createEmptyProject', () => {
  it('looks at the place it is given and has no layers or area', () => {
    const project = createEmptyProject({ lat: 54.66, lon: -2.75, zoom: 16.4 });
    expect(project).toMatchObject({ cameraLat: 54.66, cameraLon: -2.75, cameraZoom: 16.4, baseZoom: 16, layers: [] });
    expect(project.boundingBox).toBeUndefined();
  });

  it('is a valid project file: it saves and opens again unchanged', () => {
    const project = createEmptyProject();
    const reopened = loadProject(serializeProject(project));
    expect(reopened).toEqual({ ...project, version: 7 });
  });

  it('does not share its settings with other new projects', () => {
    const a = createEmptyProject();
    const b = createEmptyProject();
    a.settings.cacheDurationDays = 1;
    expect(b.settings.cacheDurationDays).toBe(7);
  });
});

describe('setProjectArea', () => {
  it('follows the view for the base zoom while there are no layers, then leaves it alone', () => {
    const empty = createEmptyProject({ lat: 0, lon: 0, zoom: 14 });
    expect(setProjectArea(empty, area, 16.6)).toMatchObject({ boundingBox: area, baseZoom: 17 });

    const withLayer = applyFetchedLayer(setProjectArea(empty, area, 16.6), 'roads', data, area);
    expect(setProjectArea(withLayer, { ...area, maxLat: 54.7 }, 12).baseZoom).toBe(17);
  });

  it('copies the area rather than sharing it', () => {
    const mine = { ...area };
    const project = setProjectArea(createEmptyProject(), mine, 15);
    mine.minLat = 0;
    expect(project.boundingBox!.minLat).toBe(54.65);
  });
});

describe('applyFetchedLayer', () => {
  it('adds layers in the usual order whatever order they arrive in', () => {
    let project = createEmptyProject();
    for (const kind of ['roads', 'water', 'transport', 'buildings', 'parks'] as const) {
      project = applyFetchedLayer(project, kind, data, area);
    }
    expect(project.layers.map((l) => l.kind)).toEqual(['transport', 'parks', 'water', 'buildings', 'roads']);
  });

  it('puts the background last and gives it the area as one rectangle', () => {
    let project = applyFetchedLayer(createEmptyProject(), 'roads', data, area);
    project = applyFetchedLayer(project, 'background', null, area);
    expect(project.layers.map((l) => l.kind)).toEqual(['roads', 'background']);
    const background = project.layers[1]!;
    expect(background.polygonFeatures).toHaveLength(1);
    expect(background.polygonFeatures[0]!.rings[0]).toEqual([
      [-2.77, 54.65], [-2.73, 54.65], [-2.73, 54.67], [-2.77, 54.67], [-2.77, 54.65],
    ]);
  });

  it('fills the layer with the features', () => {
    const project = applyFetchedLayer(createEmptyProject(), 'roads', data, area);
    expect(project.layers[0]!.lineFeatures).toEqual(data.lines);
    expect(project.layers[0]!.roadSubLayers.length).toBeGreaterThan(0);
  });

  it('replaces an existing layer in place, keeping its style and dropping its hand edits', () => {
    let project = applyFetchedLayer(createEmptyProject(), 'roads', data, area);
    const styled = { ...project.layers[0]!, name: 'My roads', labelOffsets: new Map([[1, [3, 4] as [number, number]]]), labelPins: new Map([[1, [50]]]) };
    project = { ...project, layers: [styled] };
    const fresh: FetchResult = { ...data, lines: [{ id: 2, tags: {}, coordinates: [[0, 0], [1, 1]] }] };

    const next = applyFetchedLayer(project, 'roads', fresh, area);
    expect(next.layers).toHaveLength(1);
    expect(next.layers[0]!.name).toBe('My roads');
    expect(next.layers[0]!.lineFeatures.map((l) => l.id)).toEqual([2]);
    expect(next.layers[0]!.labelOffsets.size).toBe(0);
    expect(next.layers[0]!.labelPins.size).toBe(0);
  });

  it('leaves other layers untouched', () => {
    const project = applyFetchedLayer(createEmptyProject(), 'water', data, area);
    const water = project.layers[0]!;
    const next = applyFetchedLayer(project, 'roads', data, area);
    expect(next.layers.find((l) => l.kind === 'water')).toBe(water);
  });

  it('puts a kind that has no usual place on top', () => {
    let project = applyFetchedLayer(createEmptyProject(), 'roads', data, area);
    project = applyFetchedLayer(project, 'dining', { lines: [], polygons: [], points: [] }, area);
    expect(project.layers.map((l) => l.kind)).toEqual(['dining', 'roads']);
  });

  it('writes a project that saves and opens again', () => {
    let project = setProjectArea(createEmptyProject(), area, 16);
    for (const kind of [...FETCH_KINDS, 'background' as const]) project = applyFetchedLayer(project, kind, data, area);
    const reopened = loadProject(serializeProject(project));
    expect(reopened.layers.map((l) => l.kind)).toEqual(project.layers.map((l) => l.kind));
    expect(reopened.boundingBox).toEqual(area);
    void createLayer;
  });
});

describe('FETCH_KINDS', () => {
  it('lists the layers the Area phase offers, top row first', () => {
    expect(FETCH_KINDS).toEqual(['transport', 'pedestrian_zones', 'parks', 'water', 'buildings', 'roads']);
  });
});
