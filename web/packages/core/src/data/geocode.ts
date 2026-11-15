import type { BoundingBox } from '../model/project';
import type { AbortSignalLike, HttpFetch } from './overpass';

/** A place found by name. */
export interface GeocodeResult {
  displayName: string;
  /** The first part of the name, for a short label. */
  shortName: string;
  lat: number;
  lon: number;
  /** The place's extent, when the server gives one. */
  boundingBox?: BoundingBox;
}

/** Reads Nominatim's JSON answer, skipping entries it cannot use. */
export function parseGeocode(json: unknown): GeocodeResult[] {
  if (!Array.isArray(json)) return [];
  const results: GeocodeResult[] = [];
  for (const item of json) {
    if (typeof item !== 'object' || item === null) continue;
    const entry = item as Record<string, unknown>;
    const name = entry['display_name'];
    const lat = Number(entry['lat']);
    const lon = Number(entry['lon']);
    if (typeof name !== 'string' || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    let boundingBox: BoundingBox | undefined;
    const box = entry['boundingbox'];
    if (Array.isArray(box) && box.length === 4) {
      // Nominatim writes south, north, west, east.
      const [south, north, west, east] = box.map(Number) as [number, number, number, number];
      if ([south, north, west, east].every(Number.isFinite)) {
        boundingBox = { minLat: south, minLon: west, maxLat: north, maxLon: east };
      }
    }
    results.push({ displayName: name, shortName: name.split(',')[0]!.trim(), lat, lon, boundingBox });
  }
  return results;
}

export interface SearchOptions {
  /** The network, passed in by the app; tests pass a stand-in. */
  fetchImpl: HttpFetch;
  signal?: AbortSignalLike;
  /** The server; the public one by default. */
  endpoint?: string;
}

/**
 * Looks a place up by name with Nominatim. The service's usage policy allows
 * about one request a second and forbids searching as the user types, so call
 * this only when a search is asked for.
 */
export async function searchPlaces(query: string, options: SearchOptions): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (trimmed === '') return [];
  const base = options.endpoint ?? 'https://nominatim.openstreetmap.org/search';
  const url = `${base}?q=${encodeURIComponent(trimmed)}&format=json&limit=5`;
  const response = await options.fetchImpl(url, { signal: options.signal });
  if (!response.ok) throw new Error(`The place search answered ${response.status}.`);
  return parseGeocode(await response.json());
}
