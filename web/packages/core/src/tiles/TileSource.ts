/**
 * Where reference tiles come from. Tiles are a tracing aid only and are never
 * exported, so a source only has to say how to fetch and credit them.
 *
 * `kind` is the extension point: today only raster XYZ exists. Vector tiles,
 * PMTiles archives and a georeferenced reference image are expected later and
 * should be added as new members of the `TileSource` union.
 */
export interface RasterXYZSource {
  kind: 'raster-xyz';
  id: string;
  name: string;
  /** URL with `{z}`, `{x}`, `{y}` and optionally `{s}`, `{key}` and `{r}` placeholders. */
  urlTemplate: string;
  /** Values substituted for `{s}`, chosen per tile so requests spread across hosts. */
  subdomains?: readonly string[];
  /** Shown on the map whenever these tiles are visible. Required by most providers. */
  attribution: string;
  minZoom: number;
  maxZoom: number;
  /** Edge length of one tile in CSS pixels. */
  tileSize: number;
  /** Substituted for `{key}`. Kept out of project files; it belongs in app settings. */
  apiKey?: string;
}

export type TileSource = RasterXYZSource;

/**
 * OpenStreetMap's own tile server. Its usage policy rules out heavy or
 * commercial-scale use, so this suits personal use and development only.
 */
export const OSM_STANDARD: RasterXYZSource = {
  kind: 'raster-xyz',
  id: 'osm-standard',
  name: 'OpenStreetMap',
  urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '© OpenStreetMap contributors',
  minZoom: 0,
  maxZoom: 19,
  tileSize: 256,
};

/** The URL of one tile. `x` wraps around the antimeridian; `y` must be in range. */
export function tileUrl(source: RasterXYZSource, z: number, x: number, y: number): string {
  const count = 2 ** z;
  const wrappedX = ((x % count) + count) % count;
  if (y < 0 || y >= count) throw new RangeError(`Tile row ${y} is outside zoom ${z}`);
  if (source.urlTemplate.includes('{key}') && !source.apiKey) {
    throw new Error(`Tile source "${source.name}" needs an API key`);
  }
  const subdomains = source.subdomains ?? [];
  const subdomain = subdomains.length ? subdomains[(wrappedX + y) % subdomains.length]! : '';
  return source.urlTemplate
    .replaceAll('{z}', String(z))
    .replaceAll('{x}', String(wrappedX))
    .replaceAll('{y}', String(y))
    .replaceAll('{s}', subdomain)
    .replaceAll('{r}', '')
    .replaceAll('{key}', encodeURIComponent(source.apiKey ?? ''));
}
