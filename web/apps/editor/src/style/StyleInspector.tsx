import {
  applyTextStyleToLabel,
  featureKind,
  hasManualEdits,
  LAYER_KIND_META,
  resetManualEdits,
  resetRoadLabelOverrides,
  resetRoadLineOverrides,
  updateRoadLabelStyle,
  updateRoadLineStyle,
  type AreaStyle,
  type CodableColor,
  type LabelStyle,
  type LayerLabelFit,
  type LayerSnapshot,
  type POIStyle,
  type ProjectSnapshot,
  type RoadStyle,
} from '@nolli/core';
import { useState } from 'react';
import { ColorRow, type ColorLibraryActions } from './ColorWell';
import {
  AnchorGrid,
  CollapsibleSection,
  NumberInput,
  PropRow,
  SegmentedControl,
  SliderNumberRow,
  SwitchToggle,
} from './Controls';
import { layerIconGlyph } from './LayersPanel';

const COMMON_FONT_FAMILIES = [
  'Helvetica Neue',
  'Inter',
  'Fira Sans',
  'Noto Sans',
  'Arial',
  'Georgia',
  'Times New Roman',
];

const COMMON_FONT_WEIGHTS = [
  'Regular',
  'Light',
  'Medium',
  'Semibold',
  'Bold',
  'Heavy',
  'Italic',
  'Bold Italic',
];

const AVAILABLE_TAGS = [
  'name',
  'name:en',
  'ref',
  'addr:housenumber',
  'alt_name',
  'short_name',
  'old_name',
];

const DEFAULT_BACKGROUND_COLOR: CodableColor = {
  r: 0.973,
  g: 0.961,
  b: 0.941,
  a: 1,
};

export function StyleInspector({
  project,
  selectedLayerId,
  liveZoom,
  liveRotation,
  labelFits,
  colorLibrary,
  onEditProject,
  onEditLayer,
  onSaveTextStyle,
}: {
  project: ProjectSnapshot | null;
  selectedLayerId: string | null;
  liveZoom: number;
  liveRotation: number;
  labelFits: Readonly<Record<string, LayerLabelFit>>;
  colorLibrary: ColorLibraryActions;
  onEditProject: (
    updater: (project: ProjectSnapshot) => ProjectSnapshot,
    coalesceKey?: string,
  ) => void;
  onEditLayer: (
    layerId: string,
    updater: (layer: LayerSnapshot) => LayerSnapshot,
    coalesceKey?: string,
  ) => void;
  onSaveTextStyle: (layerId: string, name: string) => void;
}) {
  const [selectedSubByLayer, setSelectedSubByLayer] = useState<Record<string, string | null>>({});
  const [activeTab, setActiveTab] = useState<'style' | 'labels'>('style');
  const [newTextStyleName, setNewTextStyleName] = useState('');

  if (!project) {
    return (
      <aside className="right-panel" aria-label="Inspector">
        <div className="panel-empty">
          <p className="hint">No project open.</p>
        </div>
      </aside>
    );
  }

  const selectedLayer =
    selectedLayerId !== null
      ? (project.layers.find((layer) => layer.id === selectedLayerId) ?? null)
      : null;

  if (!selectedLayer) {
    const bgEnabled = project.artboardBackgroundEnabled ?? false;
    const bgColor = project.artboardBackground ?? DEFAULT_BACKGROUND_COLOR;

    return (
      <aside className="right-panel" aria-label="Inspector">
        <header className="inspector-header">
          <span className="inspector-icon" aria-hidden="true">
            🗺
          </span>
          <div>
            <h2>Map</h2>
            <p className="inspector-subtitle">Applies to the whole map</p>
          </div>
        </header>

        <div className="inspector-scroll">
          <CollapsibleSection
            title="Background"
            defaultOpen={true}
            trailing={
              <SwitchToggle
                checked={bgEnabled}
                ariaLabel="Artboard background"
                onChange={(enabled) =>
                  onEditProject((p) => ({
                    ...p,
                    artboardBackgroundEnabled: enabled,
                    artboardBackground: p.artboardBackground ?? DEFAULT_BACKGROUND_COLOR,
                  }))
                }
              />
            }
          >
            {bgEnabled ? (
              <ColorRow
                label="Fill"
                color={bgColor}
                library={colorLibrary}
                onChange={(color) =>
                  onEditProject((p) => ({ ...p, artboardBackground: color }), 'map.bg')
                }
              />
            ) : (
              <p className="hint">No fill: the map tiles show behind your layers.</p>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            title="Map tiles"
            defaultOpen={true}
            trailing={
              <SwitchToggle
                checked={project.settings.showTileBackground}
                ariaLabel="Show map tiles"
                onChange={(showTileBackground) =>
                  onEditProject((p) => ({
                    ...p,
                    settings: { ...p.settings, showTileBackground },
                  }))
                }
              />
            }
          >
            {project.settings.showTileBackground && (
              <>
                <SliderNumberRow
                  label="Opacity"
                  value={Math.round(project.settings.tileOpacity * 100)}
                  min={0}
                  max={100}
                  step={1}
                  unit="%"
                  onChange={(pct) =>
                    onEditProject(
                      (p) => ({
                        ...p,
                        settings: {
                          ...p.settings,
                          tileOpacity: Math.max(0, Math.min(1, pct / 100)),
                        },
                      }),
                      'map.tileOpacity',
                    )
                  }
                />
                <p className="hint">Reference only: tiles are never exported.</p>
              </>
            )}
          </CollapsibleSection>

          <CollapsibleSection title="View" defaultOpen={true}>
            <SliderNumberRow
              label="Rotation"
              value={Math.round(liveRotation * 10) / 10}
              min={-180}
              max={180}
              step={1}
              digits={1}
              unit="°"
              onChange={(deg) =>
                onEditProject((p) => ({ ...p, artboardRotation: deg }), 'map.rotation')
              }
            />
            <PropRow label="North arrow">
              <SwitchToggle
                checked={project.showNorthArrow}
                ariaLabel="Show north arrow"
                onChange={(showNorthArrow) =>
                  onEditProject((p) => ({ ...p, showNorthArrow }))
                }
              />
            </PropRow>
            {project.showNorthArrow && (
              <PropRow label="Position">
                <select
                  className="prop-select"
                  aria-label="North arrow position"
                  value={project.northArrowPosition}
                  onChange={(event) =>
                    onEditProject((p) => ({
                      ...p,
                      northArrowPosition:
                        event.target.value as ProjectSnapshot['northArrowPosition'],
                    }))
                  }
                >
                  <option value="top_left">Top left</option>
                  <option value="top_right">Top right</option>
                  <option value="bottom_left">Bottom left</option>
                  <option value="bottom_right">Bottom right</option>
                </select>
              </PropRow>
            )}
          </CollapsibleSection>

          <CollapsibleSection title="Design scale" defaultOpen={true}>
            <PropRow label="Base zoom">
              <NumberInput
                value={project.baseZoom}
                min={1}
                max={22}
                step={1}
                ariaLabel="Base zoom"
                onChange={(baseZoom) =>
                  onEditProject((p) => ({ ...p, baseZoom: Math.round(baseZoom) }))
                }
              />
              <button
                type="button"
                className="secondary-btn"
                onClick={() =>
                  onEditProject((p) => ({ ...p, baseZoom: Math.round(liveZoom) }))
                }
              >
                Use {Math.round(liveZoom)}
              </button>
            </PropRow>
            <p className="hint">
              Line widths, text and icons are 1:1 at this zoom, and scale with the map like vector
              artwork.
            </p>
          </CollapsibleSection>

          <CollapsibleSection title="Signs" defaultOpen={false}>
            <SliderNumberRow
              label="Artwork ×"
              value={project.signArtworkScale}
              min={0.1}
              max={5}
              hardMin={0.05}
              hardMax={20}
              step={0.05}
              digits={2}
              onChange={(signArtworkScale) =>
                onEditProject((p) => ({ ...p, signArtworkScale }), 'map.signScale')
              }
            />
            <PropRow label="New size">
              <NumberInput
                prefix="W"
                value={project.settings.defaultWidthMM}
                min={10}
                max={5000}
                step={10}
                onChange={(defaultWidthMM) =>
                  onEditProject((p) => ({
                    ...p,
                    settings: { ...p.settings, defaultWidthMM },
                  }))
                }
              />
              <NumberInput
                prefix="H"
                value={project.settings.defaultHeightMM}
                min={10}
                max={5000}
                step={10}
                onChange={(defaultHeightMM) =>
                  onEditProject((p) => ({
                    ...p,
                    settings: { ...p.settings, defaultHeightMM },
                  }))
                }
              />
            </PropRow>
            <PropRow label="New DPI">
              <NumberInput
                value={project.settings.defaultDPI}
                min={36}
                max={1200}
                step={10}
                ariaLabel="New DPI"
                onChange={(defaultDPI) =>
                  onEditProject((p) => ({
                    ...p,
                    settings: { ...p.settings, defaultDPI },
                  }))
                }
              />
            </PropRow>
          </CollapsibleSection>
        </div>
      </aside>
    );
  }

  // Layer selected ------------------------------------------------------------
  const fKind = featureKind(selectedLayer.kind);
  const featureCount =
    selectedLayer.lineFeatures.length +
    selectedLayer.polygonFeatures.length +
    selectedLayer.pointFeatures.length;
  const subIdCandidate = selectedSubByLayer[selectedLayer.id] ?? null;
  const activeSub =
    selectedLayer.kind === 'roads' && subIdCandidate !== null
      ? (selectedLayer.roadSubLayers.find((sub) => sub.id === subIdCandidate) ?? null)
      : null;
  const activeSubId = activeSub?.id ?? null;

  const setActiveSubId = (subId: string | null) => {
    setSelectedSubByLayer((current) => ({ ...current, [selectedLayer.id]: subId }));
  };

  const roadStyle: RoadStyle = activeSub ? activeSub.customStyle : selectedLayer.roadStyle;
  const lineOverrides = activeSub?.lineOverrides ?? new Set<string>();
  const labelStyle: LabelStyle =
    activeSub ? (activeSub.labelStyle ?? selectedLayer.labelStyle) : selectedLayer.labelStyle;
  const labelOverrides = activeSub?.labelOverrides ?? new Set<string>();

  const editLine = (patch: Partial<RoadStyle>, coalesceField?: string) => {
    onEditLayer(
      selectedLayer.id,
      (layer) => updateRoadLineStyle(layer, activeSubId, patch),
      coalesceField ? `line.${selectedLayer.id}.${activeSubId ?? 'all'}.${coalesceField}` : undefined,
    );
  };

  const resetLine = (keys?: readonly string[]) => {
    if (!activeSubId) return;
    onEditLayer(selectedLayer.id, (layer) => resetRoadLineOverrides(layer, activeSubId, keys));
  };

  const editArea = (patch: Partial<AreaStyle>, coalesceField?: string) => {
    onEditLayer(
      selectedLayer.id,
      (layer) => ({ ...layer, areaStyle: { ...layer.areaStyle, ...patch } }),
      coalesceField ? `area.${selectedLayer.id}.${coalesceField}` : undefined,
    );
  };

  const editPoi = (patch: Partial<POIStyle>, coalesceField?: string) => {
    onEditLayer(
      selectedLayer.id,
      (layer) => ({ ...layer, poiStyle: { ...layer.poiStyle, ...patch } }),
      coalesceField ? `poi.${selectedLayer.id}.${coalesceField}` : undefined,
    );
  };

  const editLabel = (patch: Partial<LabelStyle>, coalesceField?: string) => {
    onEditLayer(
      selectedLayer.id,
      (layer) => updateRoadLabelStyle(layer, activeSubId, patch),
      coalesceField ? `label.${selectedLayer.id}.${activeSubId ?? 'all'}.${coalesceField}` : undefined,
    );
  };

  const resetLabel = (keys?: readonly string[]) => {
    if (!activeSubId) return;
    onEditLayer(selectedLayer.id, (layer) => resetRoadLabelOverrides(layer, activeSubId, keys));
  };

  const fit = labelFits[selectedLayer.id];
  const hasLines = selectedLayer.kind === 'roads' || selectedLayer.lineFeatures.length > 0;
  const hasSpots =
    selectedLayer.kind !== 'roads' &&
    (selectedLayer.polygonFeatures.length > 0 ||
      selectedLayer.pointFeatures.length > 0 ||
      selectedLayer.lineFeatures.length === 0);

  const fontFamilies = Array.from(
    new Set([labelStyle.fontName, ...COMMON_FONT_FAMILIES].filter(Boolean)),
  );
  const fontWeights = Array.from(
    new Set([labelStyle.fontWeight, ...COMMON_FONT_WEIGHTS].filter(Boolean)),
  );

  const styleTabTitle =
    selectedLayer.kind === 'roads' || fKind === 'line'
      ? 'Line'
      : fKind === 'polygon'
        ? 'Style'
        : 'Marker';

  return (
    <aside className="right-panel" aria-label="Inspector">
      <header className="inspector-header">
        <span className="inspector-icon" aria-hidden="true">
          {layerIconGlyph(selectedLayer.kind)}
        </span>
        <div>
          <h2>{selectedLayer.name}</h2>
          <p className="inspector-subtitle">
            {featureCount.toLocaleString()} features
            {selectedLayer.kind === 'roads'
              ? ` · ${selectedLayer.roadSubLayers.length} types`
              : ` · ${LAYER_KIND_META[selectedLayer.kind].displayName}`}
          </p>
        </div>
      </header>

      {selectedLayer.kind === 'roads' && (
        <div className="road-chips-block">
          <div className="road-chips-header">
            <span className="chips-overline">EDITING</span>
            {activeSub && (
              <button
                type="button"
                className="chip-vis-btn"
                onClick={() =>
                  onEditLayer(selectedLayer.id, (layer) => ({
                    ...layer,
                    roadSubLayers: layer.roadSubLayers.map((sub) =>
                      sub.id === activeSub.id ? { ...sub, isVisible: !sub.isVisible } : sub,
                    ),
                  }))
                }
              >
                {activeSub.isVisible ? 'Visible' : 'Hidden'}
              </button>
            )}
          </div>
          <div className="road-chips" role="tablist" aria-label="Road types">
            <button
              type="button"
              role="tab"
              aria-selected={activeSubId === null}
              className={`road-chip${activeSubId === null ? ' active' : ''}`}
              onClick={() => setActiveSubId(null)}
            >
              All roads
            </button>
            {selectedLayer.roadSubLayers.map((sub) => {
              const hasOverride =
                (sub.lineOverrides?.size ?? 0) > 0 || (sub.labelOverrides?.size ?? 0) > 0;
              return (
                <button
                  key={sub.id}
                  type="button"
                  role="tab"
                  aria-selected={activeSubId === sub.id}
                  className={`road-chip${activeSubId === sub.id ? ' active' : ''}${
                    !sub.isVisible ? ' is-hidden' : ''
                  }`}
                  onClick={() => setActiveSubId(sub.id)}
                >
                  <span>{sub.name}</span>
                  {hasOverride && (
                    <span className="chip-override-dot" title={`${sub.name} has custom values`} />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="inspector-tabs" role="tablist" aria-label="Inspector mode">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'style'}
          className={`inspector-tab${activeTab === 'style' ? ' active' : ''}`}
          onClick={() => setActiveTab('style')}
        >
          {styleTabTitle}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'labels'}
          className={`inspector-tab${activeTab === 'labels' ? ' active' : ''}`}
          onClick={() => setActiveTab('labels')}
        >
          Labels
        </button>
      </div>

      <div className="inspector-scroll">
        {activeTab === 'style' ? (
          <>
            {selectedLayer.kind === 'roads' && activeSub && lineOverrides.size > 0 && (
              <div className="override-banner" data-testid="line-override-banner">
                <span>
                  <span className="override-dot" /> {lineOverrides.size}{' '}
                  {lineOverrides.size === 1 ? 'value differs' : 'values differ'} from All roads
                </span>
                <button type="button" className="link-button" onClick={() => resetLine()}>
                  Reset all
                </button>
              </div>
            )}

            {fKind === 'line' && (
              <>
                <CollapsibleSection title="Stroke" defaultOpen={true}>
                  <ColorRow
                    label="Color"
                    color={roadStyle.color}
                    opacity={roadStyle.opacity}
                    library={colorLibrary}
                    overridden={lineOverrides.has('color') || lineOverrides.has('opacity')}
                    onReset={() => resetLine(['color', 'opacity'])}
                    onChange={(color) => editLine({ color }, 'color')}
                    onOpacityChange={(opacity) => editLine({ opacity }, 'opacity')}
                  />
                  <SliderNumberRow
                    label="Width"
                    value={roadStyle.width}
                    min={0.1}
                    max={16}
                    hardMin={0}
                    hardMax={200}
                    step={0.1}
                    digits={1}
                    overridden={lineOverrides.has('width')}
                    onReset={() => resetLine(['width'])}
                    onChange={(width) => editLine({ width }, 'width')}
                  />
                  <PropRow
                    label="Caps"
                    overridden={lineOverrides.has('lineCap')}
                    onReset={() => resetLine(['lineCap'])}
                  >
                    <SegmentedControl
                      value={roadStyle.lineCap}
                      options={[
                        { value: 'butt', label: 'Butt' },
                        { value: 'round', label: 'Round' },
                        { value: 'square', label: 'Square' },
                      ]}
                      onChange={(lineCap) => editLine({ lineCap })}
                      ariaLabel="Line caps"
                    />
                  </PropRow>
                  <PropRow
                    label="Joins"
                    overridden={lineOverrides.has('lineJoin')}
                    onReset={() => resetLine(['lineJoin'])}
                  >
                    <SegmentedControl
                      value={roadStyle.lineJoin}
                      options={[
                        { value: 'miter', label: 'Miter' },
                        { value: 'round', label: 'Round' },
                        { value: 'bevel', label: 'Bevel' },
                      ]}
                      onChange={(lineJoin) => editLine({ lineJoin })}
                      ariaLabel="Line joins"
                    />
                  </PropRow>
                </CollapsibleSection>

                <CollapsibleSection
                  title="Casing"
                  defaultOpen={roadStyle.casingEnabled}
                  trailing={
                    <SwitchToggle
                      checked={roadStyle.casingEnabled}
                      ariaLabel="Enable casing"
                      onChange={(casingEnabled) => editLine({ casingEnabled })}
                    />
                  }
                >
                  {roadStyle.casingEnabled && (
                    <>
                      <ColorRow
                        label="Color"
                        color={roadStyle.casingColor}
                        library={colorLibrary}
                        overridden={lineOverrides.has('casingColor')}
                        onReset={() => resetLine(['casingColor'])}
                        onChange={(casingColor) => editLine({ casingColor }, 'casingColor')}
                      />
                      <SliderNumberRow
                        label="Width"
                        value={roadStyle.casingWidth}
                        min={0.1}
                        max={24}
                        hardMin={0}
                        hardMax={200}
                        step={0.1}
                        digits={1}
                        overridden={lineOverrides.has('casingWidth')}
                        onReset={() => resetLine(['casingWidth'])}
                        onChange={(casingWidth) => editLine({ casingWidth }, 'casingWidth')}
                      />
                    </>
                  )}
                </CollapsibleSection>
              </>
            )}

            {fKind === 'polygon' && (
              <>
                <CollapsibleSection title="Fill" defaultOpen={true}>
                  <ColorRow
                    label="Color"
                    color={selectedLayer.areaStyle.fillColor}
                    opacity={selectedLayer.areaStyle.fillOpacity}
                    library={colorLibrary}
                    onChange={(fillColor) => editArea({ fillColor }, 'fillColor')}
                    onOpacityChange={(fillOpacity) => editArea({ fillOpacity }, 'fillOpacity')}
                  />
                </CollapsibleSection>
                <CollapsibleSection
                  title="Stroke"
                  defaultOpen={true}
                  trailing={
                    <SwitchToggle
                      checked={selectedLayer.areaStyle.strokeEnabled}
                      ariaLabel="Enable stroke"
                      onChange={(strokeEnabled) => editArea({ strokeEnabled })}
                    />
                  }
                >
                  {selectedLayer.areaStyle.strokeEnabled && (
                    <>
                      <ColorRow
                        label="Color"
                        color={selectedLayer.areaStyle.strokeColor}
                        library={colorLibrary}
                        onChange={(strokeColor) => editArea({ strokeColor }, 'strokeColor')}
                      />
                      <SliderNumberRow
                        label="Width"
                        value={selectedLayer.areaStyle.strokeWidth}
                        min={0.1}
                        max={8}
                        hardMin={0}
                        hardMax={100}
                        step={0.1}
                        digits={1}
                        onChange={(strokeWidth) => editArea({ strokeWidth }, 'strokeWidth')}
                      />
                    </>
                  )}
                </CollapsibleSection>
              </>
            )}

            {fKind === 'point' && (
              <CollapsibleSection title="Marker" defaultOpen={true}>
                <PropRow label="Shape">
                  <SegmentedControl
                    value={selectedLayer.poiStyle.shape}
                    options={[
                      { value: 'circle', label: 'Circle' },
                      { value: 'square', label: 'Square' },
                      { value: 'diamond', label: 'Diamond' },
                    ]}
                    onChange={(shape) => editPoi({ shape })}
                    ariaLabel="Marker shape"
                  />
                </PropRow>
                <SliderNumberRow
                  label="Size"
                  value={selectedLayer.poiStyle.size}
                  min={1}
                  max={32}
                  hardMin={0.5}
                  hardMax={200}
                  step={0.5}
                  digits={1}
                  onChange={(size) => editPoi({ size }, 'size')}
                />
                <ColorRow
                  label="Fill"
                  color={selectedLayer.poiStyle.fillColor}
                  library={colorLibrary}
                  onChange={(fillColor) => editPoi({ fillColor }, 'fillColor')}
                />
                <ColorRow
                  label="Stroke"
                  color={selectedLayer.poiStyle.strokeColor}
                  library={colorLibrary}
                  onChange={(strokeColor) => editPoi({ strokeColor }, 'strokeColor')}
                />
                <SliderNumberRow
                  label="Stroke w"
                  value={selectedLayer.poiStyle.strokeWidth}
                  min={0}
                  max={6}
                  hardMin={0}
                  hardMax={50}
                  step={0.1}
                  digits={1}
                  onChange={(strokeWidth) => editPoi({ strokeWidth }, 'strokeWidth')}
                />
              </CollapsibleSection>
            )}

            {hasManualEdits(selectedLayer) && (
              <CollapsibleSection title="Manual edits" defaultOpen={true}>
                <p className="hint">
                  Moved labels, moved icons or reshaped geometry on this layer.
                </p>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() =>
                    onEditLayer(selectedLayer.id, (layer) => resetManualEdits(layer))
                  }
                >
                  ↺ Reset to Layer Settings
                </button>
              </CollapsibleSection>
            )}
          </>
        ) : (
          /* Labels tab ---------------------------------------------------- */
          <>
            <div className="label-enable-bar">
              <span>{activeSub ? `Label ${activeSub.name}` : 'Show labels'}</span>
              <SwitchToggle
                checked={labelStyle.enabled}
                ariaLabel={activeSub ? `Label ${activeSub.name}` : 'Show labels'}
                onChange={(enabled) => {
                  if (!activeSub) {
                    editLabel({ enabled });
                  } else {
                    editLabel({ enabled });
                  }
                }}
              />
            </div>

            {selectedLayer.labelStyle.enabled && fit && fit.totalNames > 0 && (
              <div
                className={`fit-banner${fit.placedNames < fit.totalNames ? ' warn' : ' ok'}`}
                data-testid="label-fit-banner"
              >
                {fit.placedNames < fit.totalNames ? (
                  <>
                    <strong>
                      ⚠ {fit.placedNames} of {fit.totalNames} names fit on the map
                    </strong>
                    <span>Reduce the margin, or move this layer up.</span>
                  </>
                ) : (
                  <span>
                    {fit.placedNames} of {fit.totalNames} names on the map.
                  </span>
                )}
              </div>
            )}

            {selectedLayer.kind === 'roads' && activeSub && labelOverrides.size > 0 && (
              <div className="override-banner" data-testid="label-override-banner">
                <span>
                  <span className="override-dot" /> {labelOverrides.size}{' '}
                  {labelOverrides.size === 1 ? 'value differs' : 'values differ'} from All roads
                </span>
                <button type="button" className="link-button" onClick={() => resetLabel()}>
                  Reset all
                </button>
              </div>
            )}

            <CollapsibleSection title="Text" defaultOpen={true}>
              <PropRow
                label="Font"
                overridden={labelOverrides.has('fontName')}
                onReset={() => resetLabel(['fontName'])}
              >
                <select
                  className="prop-select"
                  aria-label="Font"
                  value={labelStyle.fontName}
                  onChange={(event) => editLabel({ fontName: event.target.value })}
                >
                  {fontFamilies.map((family) => (
                    <option key={family} value={family}>
                      {family}
                    </option>
                  ))}
                </select>
              </PropRow>

              <PropRow
                label="Style"
                overridden={labelOverrides.has('fontWeight')}
                onReset={() => resetLabel(['fontWeight'])}
              >
                <select
                  className="prop-select"
                  aria-label="Style"
                  value={labelStyle.fontWeight}
                  onChange={(event) => editLabel({ fontWeight: event.target.value })}
                >
                  {fontWeights.map((weight) => (
                    <option key={weight} value={weight}>
                      {weight}
                    </option>
                  ))}
                </select>
              </PropRow>

              <SliderNumberRow
                label="Size"
                value={labelStyle.fontSize}
                min={1}
                max={36}
                hardMin={0.5}
                hardMax={400}
                step={0.5}
                digits={1}
                overridden={labelOverrides.has('fontSize')}
                onReset={() => resetLabel(['fontSize'])}
                onChange={(fontSize) => editLabel({ fontSize }, 'fontSize')}
              />

              <ColorRow
                label="Color"
                color={labelStyle.color}
                opacity={labelStyle.opacity}
                library={colorLibrary}
                overridden={labelOverrides.has('color') || labelOverrides.has('opacity')}
                onReset={() => resetLabel(['color', 'opacity'])}
                onChange={(color) => editLabel({ color }, 'color')}
                onOpacityChange={(opacity) => editLabel({ opacity }, 'opacity')}
              />

              <PropRow
                label="Case"
                overridden={labelOverrides.has('typeCase')}
                onReset={() => resetLabel(['typeCase'])}
              >
                <select
                  className="prop-select"
                  aria-label="Case"
                  value={labelStyle.typeCase}
                  onChange={(event) =>
                    editLabel({ typeCase: event.target.value as LabelStyle['typeCase'] })
                  }
                >
                  <option value="as_stored">As stored</option>
                  <option value="uppercase">ALL UPPERCASE</option>
                  <option value="title_case">Title Case</option>
                  <option value="lowercase">all lowercase</option>
                  <option value="sentence_case">Sentence case</option>
                </select>
              </PropRow>

              <SliderNumberRow
                label="Tracking"
                value={labelStyle.tracking}
                min={0}
                max={400}
                hardMin={-200}
                hardMax={2000}
                step={5}
                overridden={labelOverrides.has('tracking')}
                onReset={() => resetLabel(['tracking'])}
                onChange={(tracking) => editLabel({ tracking }, 'tracking')}
              />

              <SliderNumberRow
                label="Word space"
                value={labelStyle.wordSpacing}
                min={0}
                max={1000}
                hardMin={-500}
                hardMax={5000}
                step={10}
                overridden={labelOverrides.has('wordSpacing')}
                onReset={() => resetLabel(['wordSpacing'])}
                onChange={(wordSpacing) => editLabel({ wordSpacing }, 'wordSpacing')}
              />

              {!activeSub && (
                <div className="text-style-preset-row">
                  <select
                    className="prop-select"
                    aria-label="Text style preset"
                    value={labelStyle.textStyleId ?? ''}
                    onChange={(event) => {
                      const id = event.target.value;
                      const preset = project.textStyles.find((ts) => ts.id === id);
                      if (preset) {
                        onEditLayer(selectedLayer.id, (layer) =>
                          updateRoadLabelStyle(
                            layer,
                            null,
                            applyTextStyleToLabel(layer.labelStyle, preset),
                          ),
                        );
                      } else {
                        editLabel({ textStyleId: undefined });
                      }
                    }}
                  >
                    <option value="">No text style preset</option>
                    {project.textStyles.map((ts) => (
                      <option key={ts.id} value={ts.id}>
                        {ts.name}
                      </option>
                    ))}
                  </select>
                  <div className="scheme-save-row">
                    <input
                      type="text"
                      placeholder="Save preset as…"
                      aria-label="Text style name"
                      value={newTextStyleName}
                      onChange={(event) => setNewTextStyleName(event.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const trimmed = newTextStyleName.trim();
                        if (!trimmed) return;
                        onSaveTextStyle(selectedLayer.id, trimmed);
                        setNewTextStyleName('');
                      }}
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
            </CollapsibleSection>

            {hasLines && (
              <CollapsibleSection
                title={selectedLayer.kind === 'roads' ? 'Along the road' : 'Along the line'}
                defaultOpen={true}
              >
                <PropRow
                  label="Mode"
                  overridden={labelOverrides.has('lineLabelMode')}
                  onReset={() => resetLabel(['lineLabelMode'])}
                >
                  <select
                    className="prop-select"
                    aria-label="Mode"
                    value={labelStyle.lineLabelMode}
                    onChange={(event) =>
                      editLabel({
                        lineLabelMode: event.target.value as LabelStyle['lineLabelMode'],
                      })
                    }
                  >
                    <option value="curved">Curved</option>
                    <option value="parallel">Parallel</option>
                    <option value="horizontal">Horizontal</option>
                  </select>
                </PropRow>

                {labelStyle.lineLabelMode !== 'horizontal' && (
                  <PropRow
                    label="Position"
                    overridden={labelOverrides.has('linePosition')}
                    onReset={() => resetLabel(['linePosition'])}
                  >
                    <SegmentedControl
                      value={labelStyle.linePosition}
                      options={[
                        { value: 'above', label: 'Above' },
                        { value: 'on', label: 'On' },
                        { value: 'below', label: 'Below' },
                      ]}
                      onChange={(linePosition) => editLabel({ linePosition })}
                      ariaLabel="Line position"
                    />
                  </PropRow>
                )}

                {(labelStyle.linePosition !== 'on' ||
                  labelStyle.lineLabelMode === 'horizontal') && (
                  <SliderNumberRow
                    label="Distance"
                    value={labelStyle.distanceFromLine}
                    min={0}
                    max={20}
                    hardMin={0}
                    hardMax={200}
                    step={0.5}
                    digits={1}
                    overridden={labelOverrides.has('distanceFromLine')}
                    onReset={() => resetLabel(['distanceFromLine'])}
                    onChange={(distanceFromLine) =>
                      editLabel({ distanceFromLine }, 'distanceFromLine')
                    }
                  />
                )}

                {labelStyle.lineLabelMode === 'curved' && (
                  <SliderNumberRow
                    label="Max bend"
                    value={labelStyle.maxCharAngle}
                    min={5}
                    max={60}
                    hardMin={1}
                    hardMax={180}
                    step={1}
                    unit="°"
                    overridden={labelOverrides.has('maxCharAngle')}
                    onReset={() => resetLabel(['maxCharAngle'])}
                    onChange={(maxCharAngle) => editLabel({ maxCharAngle }, 'maxCharAngle')}
                  />
                )}

                <SliderNumberRow
                  label="Repeat"
                  value={labelStyle.repeatInterval}
                  min={20}
                  max={1000}
                  hardMin={1}
                  hardMax={20000}
                  step={10}
                  overridden={labelOverrides.has('repeatInterval')}
                  onReset={() => resetLabel(['repeatInterval'])}
                  onChange={(repeatInterval) => editLabel({ repeatInterval }, 'repeatInterval')}
                />
              </CollapsibleSection>
            )}

            {hasSpots && (
              <CollapsibleSection
                title={hasLines ? 'Area and point names' : 'Placement'}
                defaultOpen={true}
              >
                <PropRow
                  label="Anchor"
                  overridden={labelOverrides.has('placement')}
                  onReset={() => resetLabel(['placement'])}
                >
                  <AnchorGrid
                    value={labelStyle.placement}
                    onChange={(placement) => editLabel({ placement })}
                  />
                </PropRow>
                <PropRow
                  label="Offset"
                  overridden={labelOverrides.has('offsetX') || labelOverrides.has('offsetY')}
                  onReset={() => resetLabel(['offsetX', 'offsetY'])}
                >
                  <NumberInput
                    prefix="X"
                    value={labelStyle.offsetX}
                    min={-500}
                    max={500}
                    step={0.5}
                    digits={1}
                    onChange={(offsetX) => editLabel({ offsetX }, 'offsetX')}
                  />
                  <NumberInput
                    prefix="Y"
                    value={labelStyle.offsetY}
                    min={-500}
                    max={500}
                    step={0.5}
                    digits={1}
                    onChange={(offsetY) => editLabel({ offsetY }, 'offsetY')}
                  />
                </PropRow>
              </CollapsibleSection>
            )}

            <CollapsibleSection title="Overlap" defaultOpen={false}>
              <PropRow
                label="When tight"
                overridden={labelOverrides.has('overlapMode')}
                onReset={() => resetLabel(['overlapMode'])}
              >
                <select
                  className="prop-select"
                  aria-label="When tight"
                  value={labelStyle.overlapMode}
                  onChange={(event) =>
                    editLabel({
                      overlapMode: event.target.value as LabelStyle['overlapMode'],
                    })
                  }
                >
                  <option value="never">Never overlap</option>
                  <option value="allow_if_required">Allow if required</option>
                  <option value="allow">Allow</option>
                </select>
              </PropRow>
              {labelStyle.overlapMode === 'never' && (
                <SliderNumberRow
                  label="Margin"
                  value={labelStyle.minSpacing}
                  min={0}
                  max={60}
                  hardMin={0}
                  hardMax={1000}
                  step={1}
                  overridden={labelOverrides.has('minSpacing')}
                  onReset={() => resetLabel(['minSpacing'])}
                  onChange={(minSpacing) => editLabel({ minSpacing }, 'minSpacing')}
                />
              )}
              <p className="hint">Labels of higher rows in the layer list win the space.</p>
            </CollapsibleSection>

            <CollapsibleSection
              title="Halo"
              defaultOpen={false}
              trailing={
                <SwitchToggle
                  checked={labelStyle.bufferEnabled}
                  ariaLabel="Enable halo"
                  onChange={(bufferEnabled) => editLabel({ bufferEnabled })}
                />
              }
            >
              <ColorRow
                label="Color"
                color={labelStyle.haloColor}
                opacity={labelStyle.bufferOpacity}
                library={colorLibrary}
                overridden={
                  labelOverrides.has('haloColor') || labelOverrides.has('bufferOpacity')
                }
                onReset={() => resetLabel(['haloColor', 'bufferOpacity'])}
                onChange={(haloColor) => editLabel({ haloColor }, 'haloColor')}
                onOpacityChange={(bufferOpacity) => editLabel({ bufferOpacity }, 'bufferOpacity')}
              />
              <SliderNumberRow
                label="Size"
                value={labelStyle.haloWidth}
                min={0.1}
                max={8}
                hardMin={0}
                hardMax={100}
                step={0.1}
                digits={1}
                overridden={labelOverrides.has('haloWidth')}
                onReset={() => resetLabel(['haloWidth'])}
                onChange={(haloWidth) => editLabel({ haloWidth }, 'haloWidth')}
              />
              <PropRow
                label="Joins"
                overridden={labelOverrides.has('bufferJoinStyle')}
                onReset={() => resetLabel(['bufferJoinStyle'])}
              >
                <SegmentedControl
                  value={labelStyle.bufferJoinStyle}
                  options={[
                    { value: 'miter', label: 'Miter' },
                    { value: 'round', label: 'Round' },
                    { value: 'bevel', label: 'Bevel' },
                  ]}
                  onChange={(bufferJoinStyle) => editLabel({ bufferJoinStyle })}
                  ariaLabel="Halo joins"
                />
              </PropRow>
            </CollapsibleSection>

            <CollapsibleSection
              title="Shadow"
              defaultOpen={false}
              trailing={
                <SwitchToggle
                  checked={labelStyle.shadowEnabled}
                  ariaLabel="Enable shadow"
                  onChange={(shadowEnabled) => editLabel({ shadowEnabled })}
                />
              }
            >
              <ColorRow
                label="Color"
                color={labelStyle.shadowColor}
                opacity={labelStyle.shadowOpacity}
                library={colorLibrary}
                overridden={
                  labelOverrides.has('shadowColor') || labelOverrides.has('shadowOpacity')
                }
                onReset={() => resetLabel(['shadowColor', 'shadowOpacity'])}
                onChange={(shadowColor) => editLabel({ shadowColor }, 'shadowColor')}
                onOpacityChange={(shadowOpacity) => editLabel({ shadowOpacity }, 'shadowOpacity')}
              />
              <SliderNumberRow
                label="Blur"
                value={labelStyle.shadowBlur}
                min={0}
                max={20}
                hardMin={0}
                hardMax={200}
                step={0.5}
                digits={1}
                overridden={labelOverrides.has('shadowBlur')}
                onReset={() => resetLabel(['shadowBlur'])}
                onChange={(shadowBlur) => editLabel({ shadowBlur }, 'shadowBlur')}
              />
              <PropRow
                label="Offset"
                overridden={
                  labelOverrides.has('shadowOffsetX') || labelOverrides.has('shadowOffsetY')
                }
                onReset={() => resetLabel(['shadowOffsetX', 'shadowOffsetY'])}
              >
                <NumberInput
                  prefix="X"
                  value={labelStyle.shadowOffsetX}
                  min={-200}
                  max={200}
                  step={0.5}
                  digits={1}
                  onChange={(shadowOffsetX) => editLabel({ shadowOffsetX }, 'shadowOffsetX')}
                />
                <NumberInput
                  prefix="Y"
                  value={labelStyle.shadowOffsetY}
                  min={-200}
                  max={200}
                  step={0.5}
                  digits={1}
                  onChange={(shadowOffsetY) => editLabel({ shadowOffsetY }, 'shadowOffsetY')}
                />
              </PropRow>
            </CollapsibleSection>

            {hasSpots && (
              <CollapsibleSection
                title="Callouts"
                defaultOpen={false}
                trailing={
                  <SwitchToggle
                    checked={labelStyle.calloutsEnabled}
                    ariaLabel="Enable callouts"
                    onChange={(calloutsEnabled) => editLabel({ calloutsEnabled })}
                  />
                }
              >
                <PropRow
                  label="Style"
                  overridden={labelOverrides.has('calloutStyle')}
                  onReset={() => resetLabel(['calloutStyle'])}
                >
                  <select
                    className="prop-select"
                    aria-label="Callout style"
                    value={labelStyle.calloutStyle}
                    onChange={(event) =>
                      editLabel({
                        calloutStyle: event.target.value as LabelStyle['calloutStyle'],
                      })
                    }
                  >
                    <option value="simple_line">Simple line</option>
                    <option value="manhattan">Manhattan</option>
                    <option value="curved">Curved</option>
                    <option value="balloon">Balloon</option>
                  </select>
                </PropRow>
                <ColorRow
                  label="Color"
                  color={labelStyle.calloutColor}
                  library={colorLibrary}
                  overridden={labelOverrides.has('calloutColor')}
                  onReset={() => resetLabel(['calloutColor'])}
                  onChange={(calloutColor) => editLabel({ calloutColor }, 'calloutColor')}
                />
                <SliderNumberRow
                  label="Width"
                  value={labelStyle.calloutWidth}
                  min={0.1}
                  max={4}
                  hardMin={0}
                  hardMax={50}
                  step={0.1}
                  digits={1}
                  overridden={labelOverrides.has('calloutWidth')}
                  onReset={() => resetLabel(['calloutWidth'])}
                  onChange={(calloutWidth) => editLabel({ calloutWidth }, 'calloutWidth')}
                />
                <SliderNumberRow
                  label="Min dist"
                  value={labelStyle.calloutMinDistance}
                  min={0}
                  max={40}
                  hardMin={0}
                  hardMax={500}
                  step={1}
                  overridden={labelOverrides.has('calloutMinDistance')}
                  onReset={() => resetLabel(['calloutMinDistance'])}
                  onChange={(calloutMinDistance) =>
                    editLabel({ calloutMinDistance }, 'calloutMinDistance')
                  }
                />
              </CollapsibleSection>
            )}

            <CollapsibleSection title="Text source" defaultOpen={false}>
              <PropRow
                label="OSM tag"
                overridden={labelOverrides.has('tagKey')}
                onReset={() => resetLabel(['tagKey'])}
              >
                <select
                  className="prop-select"
                  aria-label="OSM tag"
                  value={labelStyle.tagKey}
                  onChange={(event) => editLabel({ tagKey: event.target.value })}
                >
                  {AVAILABLE_TAGS.map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
              </PropRow>
              <PropRow
                label="Fallback"
                overridden={labelOverrides.has('fallbackTagKey')}
                onReset={() => resetLabel(['fallbackTagKey'])}
              >
                <select
                  className="prop-select"
                  aria-label="Fallback tag"
                  value={labelStyle.fallbackTagKey}
                  onChange={(event) => editLabel({ fallbackTagKey: event.target.value })}
                >
                  {AVAILABLE_TAGS.map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
              </PropRow>
            </CollapsibleSection>
          </>
        )}
      </div>
    </aside>
  );
}
