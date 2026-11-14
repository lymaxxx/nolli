import {
  cssColor,
  LAYER_KIND_META,
  paletteSample,
  type FontRequest,
  type LayerKind,
  type LayerLabelFit,
  type LayerSnapshot,
  type MapColorScheme,
  type ProjectSnapshot,
} from '@nolli/core';
import { useState } from 'react';
import { FontPanel } from '../FontPanel';
import type { FontEntry } from '../fontStore';

const ALL_LAYER_KINDS: readonly LayerKind[] = [
  'roads',
  'buildings',
  'parks',
  'water',
  'pedestrian_zones',
  'plazas',
  'landmarks',
  'transport',
  'dining',
  'accommodation',
  'healthcare',
  'parking',
  'shopping',
  'education',
  'background',
];

export function layerIconGlyph(kind: LayerKind): string {
  switch (kind) {
    case 'roads':
      return '⛕';
    case 'parks':
      return '♣';
    case 'water':
      return '💧';
    case 'buildings':
      return '⌂';
    case 'pedestrian_zones':
      return '⚇';
    case 'plazas':
      return '◻';
    case 'landmarks':
      return '⌖';
    case 'transport':
      return '🚊';
    case 'dining':
      return 'Ψ';
    case 'accommodation':
      return '⌂';
    case 'healthcare':
      return '✚';
    case 'parking':
      return 'P';
    case 'shopping':
      return '🛍';
    case 'education':
      return '🎓';
    case 'background':
      return '▢';
  }
}

function featureTotal(layer: LayerSnapshot): number {
  return (
    layer.lineFeatures.length + layer.polygonFeatures.length + layer.pointFeatures.length
  );
}

export function LayersPanel({
  project,
  selectedLayerId,
  onSelectLayer,
  onToggleLayerVisible,
  onRenameLayer,
  onAddLayer,
  onRemoveLayer,
  onMoveLayer,
  labelFits,
  fontRequests,
  fontEntries,
  fontsBusy,
  onFindInstalledFonts,
  onChooseFontFile,
  onRemoveFontFile,
  onSaveScheme,
  onApplyScheme,
  onDeleteScheme,
  onDeleteTextStyle,
}: {
  project: ProjectSnapshot | null;
  selectedLayerId: string | null;
  onSelectLayer: (layerId: string | null) => void;
  onToggleLayerVisible: (layerId: string) => void;
  onRenameLayer: (layerId: string, name: string) => void;
  onAddLayer: (kind: LayerKind) => void;
  onRemoveLayer: (layerId: string) => void;
  onMoveLayer: (fromIndex: number, toIndex: number) => void;
  labelFits: Readonly<Record<string, LayerLabelFit>>;
  fontRequests: readonly FontRequest[];
  fontEntries: readonly FontEntry[];
  fontsBusy: boolean;
  onFindInstalledFonts: () => void;
  onChooseFontFile: (request: FontRequest, file: File) => void;
  onRemoveFontFile: (entry: FontEntry) => void;
  onSaveScheme: (name: string) => void;
  onApplyScheme: (scheme: MapColorScheme) => void;
  onDeleteScheme: (id: string) => void;
  onDeleteTextStyle: (id: string) => void;
}) {
  const [tab, setTab] = useState<'layers' | 'library'>('layers');
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [schemeDraft, setSchemeDraft] = useState('');

  return (
    <aside className="left-panel" aria-label="Layers and library">
      <div className="panel-tabs" role="tablist" aria-label="Left panel">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'layers'}
          className={`panel-tab${tab === 'layers' ? ' active' : ''}`}
          onClick={() => setTab('layers')}
        >
          Layers
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'library'}
          className={`panel-tab${tab === 'library' ? ' active' : ''}`}
          onClick={() => setTab('library')}
        >
          Library
        </button>
      </div>

      {!project ? (
        <div className="panel-empty">
          <p className="hint">Open a project to inspect and style its layers.</p>
        </div>
      ) : tab === 'layers' ? (
        <div className="layers-view">
          <div className="layers-scroll">
            <div
              role="button"
              tabIndex={0}
              data-testid="layer-row-map"
              className={`layer-row map-settings-row${selectedLayerId === null ? ' selected' : ''}`}
              onClick={() => onSelectLayer(null)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectLayer(null);
                }
              }}
            >
              <span className="layer-icon" aria-hidden="true">
                🗺
              </span>
              <span className="layer-name">Map</span>
              <span className="layer-count">Z {project.baseZoom}</span>
            </div>

            <div className="layers-overline">MAP LAYERS</div>

            <ul className="layer-list" aria-label="Map layers">
              {project.layers.map((layer, index) => {
                const selected = selectedLayerId === layer.id;
                const count = featureTotal(layer);
                const fit = labelFits[layer.id];
                const hasDroppedLabels =
                  layer.isVisible &&
                  layer.labelStyle.enabled &&
                  fit !== undefined &&
                  fit.totalNames > 0 &&
                  fit.placedNames < fit.totalNames;

                return (
                  <li
                    key={layer.id}
                    draggable={editingId !== layer.id}
                    data-testid={`layer-row-${layer.kind}`}
                    className={`layer-row${selected ? ' selected' : ''}${
                      !layer.isVisible ? ' is-hidden' : ''
                    }${dropIndex === index ? ' drop-target' : ''}`}
                    onClick={() => onSelectLayer(layer.id)}
                    onDoubleClick={() => {
                      setEditingId(layer.id);
                      setNameDraft(layer.name);
                    }}
                    onDragStart={(event) => {
                      setDragIndex(index);
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      if (dragIndex !== null && dragIndex !== index) {
                        setDropIndex(index);
                      }
                    }}
                    onDragLeave={() => {
                      if (dropIndex === index) setDropIndex(null);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (dragIndex !== null && dragIndex !== index) {
                        onMoveLayer(dragIndex, index);
                      }
                      setDragIndex(null);
                      setDropIndex(null);
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setDropIndex(null);
                    }}
                  >
                    <span className="layer-icon" aria-hidden="true">
                      {layerIconGlyph(layer.kind)}
                    </span>

                    {editingId === layer.id ? (
                      <input
                        type="text"
                        className="layer-rename-input"
                        aria-label="Layer name"
                        value={nameDraft}
                        autoFocus
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => setNameDraft(event.target.value)}
                        onBlur={() => {
                          const trimmed = nameDraft.trim();
                          if (trimmed) onRenameLayer(layer.id, trimmed);
                          setEditingId(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            const trimmed = nameDraft.trim();
                            if (trimmed) onRenameLayer(layer.id, trimmed);
                            setEditingId(null);
                          } else if (event.key === 'Escape') {
                            setEditingId(null);
                          }
                        }}
                      />
                    ) : (
                      <span className="layer-name" title={layer.name}>
                        {layer.name}
                      </span>
                    )}

                    {hasDroppedLabels && fit && (
                      <span
                        className="layer-warn"
                        title={`${fit.placedNames} of ${fit.totalNames} names fit on the map`}
                        aria-label={`${fit.placedNames} of ${fit.totalNames} names fit`}
                      >
                        ⚠
                      </span>
                    )}

                    <span className="layer-count">{count.toLocaleString()}</span>

                    <div className="layer-row-actions" onClick={(event) => event.stopPropagation()}>
                      <button
                        type="button"
                        className="layer-action-btn"
                        title={layer.isVisible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                        aria-label={layer.isVisible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                        onClick={() => onToggleLayerVisible(layer.id)}
                      >
                        {layer.isVisible ? '👁' : '🚫'}
                      </button>
                      {index > 0 && (
                        <button
                          type="button"
                          className="layer-action-btn"
                          title={`Move ${layer.name} up`}
                          aria-label={`Move ${layer.name} up`}
                          onClick={() => onMoveLayer(index, index - 1)}
                        >
                          ↑
                        </button>
                      )}
                      <button
                        type="button"
                        className="layer-action-btn danger"
                        title={`Delete ${layer.name}`}
                        aria-label={`Delete ${layer.name}`}
                        onClick={() => onRemoveLayer(layer.id)}
                      >
                        ×
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="layers-footer">
            <p className="reorder-hint">⋮⋮ Drag to reorder · top draws on top</p>
            <div className="add-layer-wrap">
              <button
                type="button"
                className="add-layer-btn"
                aria-expanded={showAddMenu}
                onClick={() => setShowAddMenu((current) => !current)}
              >
                + Add layer
              </button>
              {showAddMenu && (
                <div className="add-layer-menu" role="menu" aria-label="Add layer">
                  {ALL_LAYER_KINDS.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      role="menuitem"
                      className="add-layer-item"
                      onClick={() => {
                        onAddLayer(kind);
                        setShowAddMenu(false);
                      }}
                    >
                      <span>{layerIconGlyph(kind)}</span>
                      <span>{LAYER_KIND_META[kind].displayName}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="library-view">
          <FontPanel
            requests={fontRequests}
            entries={fontEntries}
            busy={fontsBusy}
            onFindInstalled={onFindInstalledFonts}
            onChooseFile={onChooseFontFile}
            onRemove={onRemoveFontFile}
          />

          <section className="library-section" aria-label="Text styles">
            <h2>Text styles</h2>
            {project.textStyles.length === 0 ? (
              <p className="hint">Save reusable typography presets from a layer’s Labels tab.</p>
            ) : (
              <ul className="library-list">
                {project.textStyles.map((ts) => (
                  <li key={ts.id} className="library-item">
                    <div>
                      <strong>{ts.name}</strong>
                      <div className="hint">
                        {ts.fontName} {ts.fontWeight} · {ts.fontSize} pt
                      </div>
                    </div>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Delete text style ${ts.name}`}
                      onClick={() => onDeleteTextStyle(ts.id)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="library-section" aria-label="Colour schemes">
            <h2>Colour schemes</h2>
            <div className="scheme-save-row">
              <input
                type="text"
                placeholder="Scheme name"
                aria-label="New scheme name"
                value={schemeDraft}
                onChange={(event) => setSchemeDraft(event.target.value)}
              />
              <button
                type="button"
                onClick={() => {
                  onSaveScheme(
                    schemeDraft.trim() || `Scheme ${(project.colorSchemes?.length ?? 0) + 1}`,
                  );
                  setSchemeDraft('');
                }}
              >
                Save
              </button>
            </div>
            {(project.colorSchemes?.length ?? 0) === 0 ? (
              <p className="hint">No colour schemes saved yet.</p>
            ) : (
              <ul className="scheme-list">
                {(project.colorSchemes ?? []).map((scheme) => (
                  <li key={scheme.id} className="scheme-row">
                    <span className="scheme-palette" aria-hidden="true">
                      {paletteSample(scheme).map((sample, idx) => (
                        <span
                          key={idx}
                          className="scheme-chip"
                          style={{ background: cssColor(sample) }}
                        />
                      ))}
                    </span>
                    <span className="scheme-name">{scheme.name}</span>
                    <button type="button" onClick={() => onApplyScheme(scheme)}>
                      Apply
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Delete scheme ${scheme.name}`}
                      onClick={() => onDeleteScheme(scheme.id)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </aside>
  );
}
