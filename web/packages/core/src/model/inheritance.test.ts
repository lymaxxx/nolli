import { describe, expect, it } from 'vitest';
import {
  applyTextStyleToLabel,
  captureTextStyleFromLabel,
  changedStyleKeys,
  createLayer,
  hasManualEdits,
  materializeRoadSubLayers,
  mergeInheritedStyle,
  resetManualEdits,
  resetRoadLabelOverrides,
  resetRoadLineOverrides,
  updateRoadLabelStyle,
  updateRoadLineStyle,
} from './inheritance';
import { DEFAULT_LABEL_STYLE, DEFAULT_ROAD_STYLE } from './styles';

describe('per-field style inheritance', () => {
  it('finds changed keys and merges unpinned master fields', () => {
    const a = { ...DEFAULT_ROAD_STYLE, width: 2 };
    const b = { ...DEFAULT_ROAD_STYLE, width: 4, color: { r: 1, g: 0, b: 0, a: 1 } };
    const changed = changedStyleKeys(a, b);
    expect(changed).toEqual(new Set(['width', 'color']));

    const merged = mergeInheritedStyle(b, { ...a, opacity: 0.5 }, new Set(['width']));
    expect(merged.width).toBe(4);
    expect(merged.color).toEqual(a.color);
    expect(merged.opacity).toBe(0.5);
  });

  it('creates a roads layer with materialized subtypes and propagates master edits to unpinned fields', () => {
    let roads = createLayer('roads');
    expect(roads.roadSubLayers).toHaveLength(10);
    const primary = roads.roadSubLayers.find((s) => s.name === 'Primary')!;
    expect(primary.customStyle.width).toBe(3);
    expect(primary.lineOverrides).toEqual(new Set(['width']));
    expect(primary.labelOverrides).toEqual(new Set());

    // Edit master road colour -> propagates to Primary while keeping Primary's pinned width=3
    roads = updateRoadLineStyle(roads, null, { color: { r: 0.8, g: 0.1, b: 0.1, a: 1 } });
    const updatedPrimary = roads.roadSubLayers.find((s) => s.name === 'Primary')!;
    expect(updatedPrimary.customStyle.color).toEqual({ r: 0.8, g: 0.1, b: 0.1, a: 1 });
    expect(updatedPrimary.customStyle.width).toBe(3);

    // Reset Primary's width override -> inherits master width (2)
    roads = resetRoadLineOverrides(roads, primary.id, ['width']);
    const resetPrimary = roads.roadSubLayers.find((s) => s.name === 'Primary')!;
    expect(resetPrimary.lineOverrides?.has('width')).toBe(false);
    expect(resetPrimary.customStyle.width).toBe(2);
  });

  it('pins subtype label overrides and resets them individually or all at once', () => {
    let roads = createLayer('roads');
    const primaryId = roads.roadSubLayers.find((s) => s.name === 'Primary')!.id;

    roads = updateRoadLabelStyle(roads, primaryId, { fontSize: 12, tracking: 40 });
    let primary = roads.roadSubLayers.find((s) => s.id === primaryId)!;
    expect(primary.labelOverrides).toEqual(new Set(['fontSize', 'tracking']));
    expect(primary.labelStyle?.fontSize).toBe(12);

    // Master fontName change propagates to Primary, while fontSize stays 12
    roads = updateRoadLabelStyle(roads, null, { fontName: 'Fira Sans', fontSize: 8 });
    primary = roads.roadSubLayers.find((s) => s.id === primaryId)!;
    expect(primary.labelStyle?.fontName).toBe('Fira Sans');
    expect(primary.labelStyle?.fontSize).toBe(12);

    // Reset all overrides on Primary
    roads = resetRoadLabelOverrides(roads, primaryId);
    primary = roads.roadSubLayers.find((s) => s.id === primaryId)!;
    expect(primary.labelOverrides?.size).toBe(0);
    expect(primary.labelStyle?.fontSize).toBe(8);
  });

  it('migrates legacy custom subtype styles into override sets on load', () => {
    const base = createLayer('roads');
    const legacy = {
      ...base,
      roadSubLayers: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          name: 'Primary',
          roadTypes: ['primary'],
          isVisible: true,
          useCustomStyle: true,
          customStyle: { ...DEFAULT_ROAD_STYLE, width: 5 },
          useCustomLabelStyle: true,
          labelStyle: { ...DEFAULT_LABEL_STYLE, enabled: true, linePosition: 'on' as const },
        },
      ],
    };
    const migrated = materializeRoadSubLayers(legacy, true);
    expect(migrated.roadSubLayers[0]!.lineOverrides).toEqual(new Set(['width']));
    expect(migrated.roadSubLayers[0]!.labelOverrides).toEqual(new Set(['linePosition']));
  });

  it('tracks and resets manual edits and captures text styles', () => {
    let layer = createLayer('landmarks');
    expect(hasManualEdits(layer)).toBe(false);
    layer = {
      ...layer,
      pointFeatures: [{ id: 1, tags: { name: 'Tower' }, coordinate: [-2.75, 54.66] }],
      labelOffsets: new Map([[1, [10, -5]]]),
      originalPointGeometry: new Map([[1, [-2.751, 54.661]]]),
    };
    expect(hasManualEdits(layer)).toBe(true);
    const reset = resetManualEdits(layer);
    expect(hasManualEdits(reset)).toBe(false);
    expect(reset.pointFeatures[0]!.coordinate).toEqual([-2.751, 54.661]);

    const preset = captureTextStyleFromLabel('Heading', { ...layer.labelStyle, fontSize: 14 });
    const applied = applyTextStyleToLabel(layer.labelStyle, preset);
    expect(applied.fontSize).toBe(14);
    expect(applied.textStyleId).toBe(preset.id);
  });
});
