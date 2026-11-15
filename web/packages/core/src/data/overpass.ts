import { areaCentroid } from '../geo/polygonCenter';
import type { LayerKind, LineFeature, PointFeature, PolygonFeature } from '../model/layers';
import type { BoundingBox } from '../model/project';
import { featureKind } from '../render/scene';

/*
 * OpenStreetMap data through the Overpass API, ported from `OSMFetcher.swift`
 * and the per-layer queries in `MapLayer.swift`.
 */

/** What one layer's request returned, in the shapes the document stores. */
export interface FetchResult {
  lines: LineFeature[];
  polygons: PolygonFeature[];
  points: PointFeature[];
}

/** The Overpass selectors for each layer kind. `{bbox}` is replaced with the area. */
const SELECTORS: Record<LayerKind, string> = {
  roads: 'way["highway"]({bbox})',
  parks:
    '(way["leisure"~"park|garden|recreation_ground"]({bbox});way["landuse"~"grass|park|recreation_ground|meadow|allotments"]({bbox});relation["leisure"~"park|garden"]({bbox});relation["landuse"~"grass|park|recreation_ground|meadow"]({bbox});)',
  water:
    '(way["natural"="water"]({bbox});way["waterway"~"river|canal|stream"]({bbox});relation["natural"="water"]({bbox});relation["waterway"="riverbank"]({bbox});)',
  buildings: '(way["building"]({bbox});relation["building"]({bbox});)',
  pedestrian_zones:
    '(way["highway"="pedestrian"]({bbox});way["highway"="pedestrian"]["area"="yes"]({bbox});)',
  plazas: '(way["place"="square"]({bbox});way["leisure"="plaza"]({bbox});)',
  landmarks:
    '(node["tourism"~"museum|gallery|artwork|attraction|viewpoint|zoo"]({bbox});node["amenity"~"theatre|library|place_of_worship|arts_centre|cinema"]({bbox});node["historic"]({bbox});)',
  transport:
    '(node["public_transport"="station"]({bbox});node["railway"~"station|halt"]({bbox});node["amenity"~"bus_station|ferry_terminal"]({bbox});way["public_transport"="station"]({bbox});way["railway"="station"]({bbox});way["amenity"~"bus_station|ferry_terminal"]({bbox});)',
  dining: '(node["amenity"~"restaurant|cafe|bar|pub|fast_food|food_court|ice_cream"]({bbox});)',
  accommodation:
    '(node["tourism"~"hotel|hostel|motel|guest_house|bed_and_breakfast|apartment"]({bbox});)',
  healthcare:
    '(node["amenity"~"hospital|clinic|pharmacy|doctors|dentist|veterinary"]({bbox});way["amenity"~"hospital|clinic"]({bbox});)',
  parking: '(way["amenity"="parking"]({bbox});node["amenity"="parking"]({bbox});)',
  shopping: '(node["shop"]({bbox});node["amenity"~"marketplace|supermarket"]({bbox});)',
  education:
    '(node["amenity"~"school|university|college|kindergarten|library"]({bbox});way["amenity"~"school|university|college"]({bbox});)',
  background: '',
};

/** Whether a layer needs data from the server. The background is just the area's outline. */
export function requiresFetch(kind: LayerKind): boolean {
  return kind !== 'background';
}

/** Overpass writes an area as south, west, north, east. */
function bboxString(bbox: BoundingBox): string {
  return `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
}

/** The query text for one layer kind within `bbox`. */
export function buildOverpassQuery(kind: LayerKind, bbox: BoundingBox): string {
  const inner = SELECTORS[kind].replaceAll('{bbox}', bboxString(bbox));
  return `[out:json][timeout:90];\n(${inner};\n);\nout body;\n>;\nout skel qt;`;
}

type Coordinate = [number, number];
type Json = Record<string, unknown>;

/*
 * The core has no DOM and no Node APIs, so the network is reached through a
 * function the app passes in (the browser's `fetch` in the editor, a stand-in
 * in tests). These are the few parts of it the core relies on.
 */
export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export interface AbortSignalLike {
  readonly aborted: boolean;
  throwIfAborted(): void;
}
export type HttpFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignalLike },
) => Promise<HttpResponse>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function tagsOf(value: unknown): Record<string, string> {
  if (!isObject(value)) return {};
  const tags: Record<string, string> = {};
  for (const [key, tag] of Object.entries(value)) if (typeof tag === 'string') tags[key] = tag;
  return tags;
}

const same = (a: Coordinate | undefined, b: Coordinate | undefined): boolean =>
  a !== undefined && b !== undefined && a[0] === b[0] && a[1] === b[1];

const isClosedRing = (ring: readonly Coordinate[]): boolean => same(ring[0], ring[ring.length - 1]);

/**
 * Joins open way segments into closed rings. The members of an OSM multipolygon
 * are often split into many ways in any order and direction. A ring the area's
 * edge cut off stays open, so it is closed to still fill.
 */
export function assembleRings(segments: readonly (readonly Coordinate[])[]): Coordinate[][] {
  const open = segments.map((segment) => [...segment]);
  const rings: Coordinate[][] = [];
  for (let ring = open.pop(); ring; ring = open.pop()) {
    let extended = true;
    while (!isClosedRing(ring) && extended) {
      extended = false;
      for (let i = 0; i < open.length; i++) {
        const s = open[i]!;
        const ringFirst = ring[0];
        const ringLast = ring[ring.length - 1];
        if (same(s[0], ringLast)) {
          ring = [...ring, ...s.slice(1)];
        } else if (same(s[s.length - 1], ringLast)) {
          ring = [...ring, ...[...s].reverse().slice(1)];
        } else if (same(s[s.length - 1], ringFirst)) {
          ring = [...s, ...ring.slice(1)];
        } else if (same(s[0], ringFirst)) {
          ring = [...[...s].reverse(), ...ring.slice(1)];
        } else {
          continue;
        }
        open.splice(i, 1);
        extended = true;
        break;
      }
    }
    if (!isClosedRing(ring) && ring.length >= 3) ring = [...ring, ring[0]!];
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

/** Turns an Overpass JSON response into features for a layer of `kind`. */
export function parseOverpass(json: unknown, kind: LayerKind): FetchResult {
  if (!isObject(json) || !Array.isArray(json['elements'])) {
    throw new Error('The server answered, but not with map data.');
  }
  const elements = json['elements'].filter(isObject);
  const shape = featureKind(kind);

  const nodes = new Map<number, Coordinate>();
  for (const el of elements) {
    if (el['type'] === 'node' && isNumber(el['id']) && isNumber(el['lat']) && isNumber(el['lon'])) {
      nodes.set(el['id'], [el['lon'], el['lat']]);
    }
  }

  // Way geometry by id, for assembling multipolygon relations: large water bodies
  // and parks are relations, so without this a river such as the Thames is missing.
  const wayCoords = new Map<number, Coordinate[]>();
  for (const el of elements) {
    if (el['type'] !== 'way' || !isNumber(el['id']) || !Array.isArray(el['nodes'])) continue;
    const coords: Coordinate[] = [];
    for (const ref of el['nodes']) {
      const c = isNumber(ref) ? nodes.get(ref) : undefined;
      if (c) coords.push(c);
    }
    wayCoords.set(el['id'], coords);
  }

  const result: FetchResult = { lines: [], polygons: [], points: [] };
  const relationMemberWays = new Set<number>();

  for (const el of elements) {
    if (el['type'] !== 'relation' || shape !== 'polygon' || !isNumber(el['id']) || !Array.isArray(el['members'])) continue;
    const tags = tagsOf(el['tags']);
    if (tags['type'] !== 'multipolygon' && tags['type'] !== 'boundary') continue;
    const outers: Coordinate[][] = [];
    const inners: Coordinate[][] = [];
    for (const member of el['members']) {
      if (!isObject(member) || member['type'] !== 'way' || !isNumber(member['ref'])) continue;
      const coords = wayCoords.get(member['ref']);
      if (!coords || coords.length < 2) continue;
      relationMemberWays.add(member['ref']);
      (member['role'] === 'inner' ? inners : outers).push(coords);
    }
    const outerRings = assembleRings(outers);
    const innerRings = assembleRings(inners);
    const relationId = el['id'];
    outerRings.forEach((ring, i) => {
      // Holes go with the first outer ring. That is right for the common single-outer
      // case, and the even-odd fill handles nesting.
      const rings = i === 0 ? [ring, ...innerRings] : [ring];
      const id = i === 0 ? -relationId : -(relationId * 1000 + i);
      result.polygons.push({ id, tags, rings });
    });
  }

  for (const el of elements) {
    if (typeof el['type'] !== 'string' || !isNumber(el['id'])) continue;
    const tags = tagsOf(el['tags']);
    const id = el['id'];

    if (el['type'] === 'node') {
      const coordinate = nodes.get(id);
      if (Object.keys(tags).length > 0 && coordinate) result.points.push({ id, tags, coordinate });
    } else if (el['type'] === 'way') {
      const coords = wayCoords.get(id);
      if (!coords || coords.length < 2) continue;
      // Untagged relation members are parts of an assembled polygon.
      if (relationMemberWays.has(id) && Object.keys(tags).length === 0) continue;

      const closed = isClosedRing(coords) && coords.length >= 4;
      const areaTagged =
        tags['area'] === 'yes' ||
        ['building', 'leisure', 'landuse', 'natural', 'place'].some((key) => tags[key] !== undefined);

      if (shape === 'point' && closed) {
        // A station or hospital mapped as an outline is one place.
        const [lat, lon] = areaCentroid(coords);
        result.points.push({ id, tags, coordinate: [lon, lat] });
      } else if (shape === 'line') {
        result.lines.push({ id, tags, coordinates: coords });
      } else if (closed && (shape === 'polygon' || areaTagged)) {
        result.polygons.push({ id, tags, rings: [coords] });
      } else {
        result.lines.push({ id, tags, coordinates: coords });
      }
    }
  }
  return result;
}

function hostOf(endpoint: string): string {
  return /^[a-z]+:\/\/([^/]+)/i.exec(endpoint)?.[1] ?? endpoint;
}

/** Public servers are often busy, so a request falls back to these before giving up. */
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

export interface FetchOptions {
  /** The server to try first. */
  endpoint: string;
  /** The network, passed in by the app (the browser's `fetch`); tests pass a stand-in. */
  fetchImpl: HttpFetch;
  signal?: AbortSignalLike;
}

/** Downloads and parses one layer's data. Tries the endpoint, then the mirrors. */
export async function fetchLayerData(
  kind: LayerKind,
  bbox: BoundingBox,
  options: FetchOptions,
): Promise<FetchResult> {
  const doFetch = options.fetchImpl;
  const body = `data=${encodeURIComponent(buildOverpassQuery(kind, bbox))}`;
  const endpoints = [options.endpoint, ...MIRRORS.filter((mirror) => mirror !== options.endpoint)];

  let lastError: unknown = new Error('No map server answered.');
  for (const endpoint of endpoints) {
    options.signal?.throwIfAborted();
    try {
      const response = await doFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: options.signal,
      });
      if (!response.ok) {
        lastError = new Error(`${hostOf(endpoint)} answered ${response.status}.`);
        continue;
      }
      return parseOverpass(await response.json(), kind);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
