import type { ProjectSnapshot } from '@nolli/core';

export interface ProjectSummary {
  version: number;
  layerCount: number;
  featureCount: number;
  lineCount: number;
  polygonCount: number;
  pointCount: number;
  roadSubLayerCount: number;
  bounds: string | null;
}

function formatCoordinate(value: number): string {
  return value.toFixed(5);
}

/** Counts what the M2 shell can show without starting the editor UI. */
export function summarizeProject(project: ProjectSnapshot): ProjectSummary {
  let lineCount = 0;
  let polygonCount = 0;
  let pointCount = 0;
  let roadSubLayerCount = 0;

  for (const layer of project.layers) {
    lineCount += layer.lineFeatures.length;
    polygonCount += layer.polygonFeatures.length;
    pointCount += layer.pointFeatures.length;
    roadSubLayerCount += layer.roadSubLayers.length;
  }

  const box = project.boundingBox;
  return {
    version: project.version,
    layerCount: project.layers.length,
    featureCount: lineCount + polygonCount + pointCount,
    lineCount,
    polygonCount,
    pointCount,
    roadSubLayerCount,
    bounds: box
      ? `${formatCoordinate(box.minLat)}, ${formatCoordinate(box.minLon)} → ${formatCoordinate(box.maxLat)}, ${formatCoordinate(box.maxLon)}`
      : null,
  };
}
