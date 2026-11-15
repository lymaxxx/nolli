import {
  FETCH_KINDS,
  LAYER_KIND_META,
  searchPlaces,
  type BoundingBox,
  type GeocodeResult,
  type LayerKind,
  type ProjectSnapshot,
} from '@nolli/core';
import { useRef, useState, type MutableRefObject } from 'react';
import type { MapApi } from '../map/MapCanvas';
import { CollapsibleSection } from '../style/Controls';
import { Icon, layerKindIcon } from '../style/Icon';

/** The layers the panel offers; the background is just the area's outline, so it needs no download. */
const OFFERED: readonly LayerKind[] = [...FETCH_KINDS, 'background'];

/** How a download stands. */
export interface FetchProgress {
  running: boolean;
  /** The layer being downloaded now. */
  current?: LayerKind;
  /** How many layers are done, and how many were asked for. */
  done: number;
  total: number;
  /** A message for each layer that could not be downloaded. */
  errors: Partial<Record<LayerKind, string>>;
  /** True once a run has finished (so the panel can say how it went). */
  finished: boolean;
  cancelled: boolean;
}

export const IDLE_PROGRESS: FetchProgress = {
  running: false,
  done: 0,
  total: 0,
  errors: {},
  finished: false,
  cancelled: false,
};

interface Props {
  project: ProjectSnapshot | null;
  mapApiRef: MutableRefObject<MapApi | null>;
  progress: FetchProgress;
  onSetArea: (area: BoundingBox, viewZoom: number) => void;
  onFetch: (kinds: LayerKind[]) => void;
  onCancel: () => void;
}

const formatBounds = (area: BoundingBox) =>
  `${area.minLat.toFixed(4)}, ${area.minLon.toFixed(4)} → ${area.maxLat.toFixed(4)}, ${area.maxLon.toFixed(4)}`;

/**
 * The Area phase: find a place, choose the area, and download its map data.
 * Searches happen only when asked for, because the place-search service does
 * not allow searching as the user types.
 */
export function AreaInspector({ project, mapApiRef, progress, onSetArea, onFetch, onCancel }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string>();
  const [drawing, setDrawing] = useState(false);
  const [chosen, setChosen] = useState<Set<LayerKind>>(() => new Set(OFFERED));
  const lastSearch = useRef(0);

  const area = project?.boundingBox;
  const hasLayers = (project?.layers.length ?? 0) > 0;

  async function search() {
    if (query.trim() === '') return;
    // The place-search service asks for at most one request a second.
    const wait = lastSearch.current + 1000 - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastSearch.current = Date.now();
    setSearching(true);
    setSearchError(undefined);
    try {
      setResults(await searchPlaces(query, { fetchImpl: (url, init) => fetch(url, init as RequestInit) }));
    } catch (error) {
      setResults(null);
      setSearchError(error instanceof Error ? error.message : String(error));
    } finally {
      setSearching(false);
    }
  }

  function goTo(place: GeocodeResult) {
    mapApiRef.current?.flyTo(place.boundingBox ?? { lat: place.lat, lon: place.lon, zoom: 16 });
    setResults(null);
    setQuery(place.shortName);
  }

  function useCurrentView() {
    const view = mapApiRef.current?.viewBounds();
    if (view) onSetArea(view.area, view.zoom);
  }

  async function drawArea() {
    setDrawing(true);
    const drawn = await mapApiRef.current?.drawArea();
    setDrawing(false);
    const view = mapApiRef.current?.viewBounds();
    if (drawn && view) onSetArea(drawn, view.zoom);
  }

  const toggle = (kind: LayerKind) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });

  const kinds = OFFERED.filter((kind) => chosen.has(kind));
  const failed = Object.entries(progress.errors);

  return (
    <aside className="right-panel" aria-label="Area">
      <header className="inspector-header">
        <span className="inspector-icon" aria-hidden="true">
          <Icon name="square-dashed" size={18} />
        </span>
        <div>
          <h2>Area</h2>
          <p className="inspector-subtitle">Choose where the map is, then download it</p>
        </div>
      </header>

      <div className="inspector-scroll">
        <CollapsibleSection title="Place">
          <form
            className="area-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}
          >
            <input
              type="search"
              aria-label="Search for a place"
              placeholder="Search for a place"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button type="submit" disabled={searching || query.trim() === ''}>
              <Icon name="search" size={14} /> Search
            </button>
          </form>
          {searching && <p className="hint">Searching…</p>}
          {searchError && (
            <p className="hint warn" role="alert">
              {searchError}
            </p>
          )}
          {results && results.length === 0 && <p className="hint">Nothing found for that name.</p>}
          {results && results.length > 0 && (
            <ul className="area-results" aria-label="Places found">
              {results.map((place) => (
                <li key={`${place.lat},${place.lon},${place.displayName}`}>
                  <button type="button" className="area-result" onClick={() => goTo(place)}>
                    <strong>{place.shortName}</strong>
                    <span>{place.displayName.split(',').slice(1, 4).join(',').trim()}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="Area">
          <div className="area-actions">
            <button type="button" onClick={useCurrentView}>
              <Icon name="maximize" size={14} /> Use current view
            </button>
            <button type="button" onClick={() => void drawArea()} aria-pressed={drawing}>
              <Icon name="square-dashed" size={14} /> {drawing ? 'Drag on the map…' : 'Draw area'}
            </button>
          </div>
          {drawing && <p className="hint">Drag a rectangle on the map. Press Escape to cancel.</p>}
          <p className="hint" data-testid="area-bounds">
            {area ? formatBounds(area) : 'No area yet. Pan and zoom the map to the place, then use the current view or draw one.'}
          </p>
        </CollapsibleSection>

        <CollapsibleSection title="Layers to download">
          <ul className="area-layers">
            {OFFERED.map((kind) => {
              const existing = project?.layers.find((layer) => layer.kind === kind);
              const count = existing
                ? existing.lineFeatures.length + existing.polygonFeatures.length + existing.pointFeatures.length
                : null;
              return (
                <li key={kind}>
                  <label>
                    <input type="checkbox" checked={chosen.has(kind)} onChange={() => toggle(kind)} />
                    <Icon name={layerKindIcon(kind)} size={14} />
                    <span>{LAYER_KIND_META[kind].displayName}</span>
                    {count !== null && <span className="layer-count">{count.toLocaleString()}</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        </CollapsibleSection>

        <div className="export-actions">
          {progress.running ? (
            <>
              <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
                <div style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
              </div>
              <p className="hint" role="status">
                Downloading {progress.current ? LAYER_KIND_META[progress.current].displayName : ''}… ({Math.min(progress.done + 1, progress.total)} of {progress.total})
              </p>
              <button type="button" onClick={onCancel}>
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={!area || kinds.length === 0}
              onClick={() => onFetch(kinds)}
            >
              <Icon name="refresh-cw" size={14} /> {hasLayers ? 'Refresh data' : 'Fetch data'}
            </button>
          )}
          {!area && <p className="hint">Choose an area first.</p>}
          {progress.finished && !progress.running && (
            <p className="hint" role="status">
              {progress.cancelled
                ? 'Cancelled. What was downloaded so far is kept.'
                : failed.length === 0
                  ? 'Done. Switch to Style to design the map.'
                  : `Done, except ${failed.length} layer${failed.length === 1 ? '' : 's'}.`}
            </p>
          )}
          {failed.length > 0 && !progress.running && (
            <ul className="area-errors" role="alert">
              {failed.map(([kind, message]) => (
                <li key={kind}>
                  <strong>{LAYER_KIND_META[kind as LayerKind].displayName}:</strong> {message}
                </li>
              ))}
              <li>Public map servers are often busy. Try again in a minute.</li>
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}
