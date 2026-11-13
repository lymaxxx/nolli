import { loadProject } from '@nolli/core';
import { describe, expect, it } from 'vitest';
import { summarizeProject } from './projectSummary';

const projectJSON = JSON.stringify({
  version: 6,
  boundingBox: { minLat: 54.65749, minLon: -2.7616, maxLat: 54.66845, maxLon: -2.74169 },
  layers: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Roads',
      kind: 'roads',
      isVisible: true,
      roadStyle: {},
      areaStyle: {},
      poiStyle: {},
      labelStyle: {},
      symbolStyle: {},
      roadSubLayers: [{}],
      lineFeatures: [
        { id: 1, tags: {}, coordinates: [[-2.75, 54.66], [-2.74, 54.67]] },
        { id: 2, tags: {}, coordinates: [[-2.75, 54.66], [-2.74, 54.67]] },
      ],
      polygonFeatures: [
        { id: 3, tags: {}, rings: [[[-2.75, 54.66], [-2.74, 54.66], [-2.75, 54.66]]] },
      ],
      pointFeatures: [
        { id: 4, tags: {}, coordinate: [-2.75, 54.66] },
        { id: 5, tags: {}, coordinate: [-2.74, 54.67] },
        { id: 6, tags: {}, coordinate: [-2.73, 54.68] },
      ],
    },
  ],
});

describe('summarizeProject', () => {
  it('counts layers, feature kinds and road sublayers after upgrading', () => {
    const summary = summarizeProject(loadProject(projectJSON));

    expect(summary).toEqual({
      version: 6,
      layerCount: 1,
      featureCount: 6,
      lineCount: 2,
      polygonCount: 1,
      pointCount: 3,
      roadSubLayerCount: 1,
      bounds: '54.65749, -2.76160 → 54.66845, -2.74169',
    });
  });

  it('omits bounds when the project has none', () => {
    const withoutBounds = JSON.parse(projectJSON) as Record<string, unknown>;
    delete withoutBounds.boundingBox;

    expect(summarizeProject(loadProject(JSON.stringify(withoutBounds))).bounds).toBeNull();
  });
});
