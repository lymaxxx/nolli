import { describe, expect, it } from 'vitest';
import {
  assembleRings,
  buildOverpassQuery,
  fetchLayerData,
  parseOverpass,
  type HttpFetch,
} from './overpass';

const bbox = { minLat: 54.6, minLon: -2.8, maxLat: 54.7, maxLon: -2.7 };
const node = (id: number, lat: number, lon: number, tags?: Record<string, string>) => ({
  type: 'node',
  id,
  lat,
  lon,
  ...(tags ? { tags } : {}),
});
const way = (id: number, nodes: number[], tags?: Record<string, string>) => ({
  type: 'way',
  id,
  nodes,
  ...(tags ? { tags } : {}),
});
const response = (...elements: unknown[]) => ({ version: 0.6, elements });

/** A unit square's corners as nodes 1 to 4. */
const square = [node(1, 0, 0), node(2, 0, 1), node(3, 1, 1), node(4, 1, 0)];

describe('buildOverpassQuery', () => {
  it('writes the area as south, west, north, east and asks for geometry', () => {
    const query = buildOverpassQuery('roads', bbox);
    expect(query).toContain('way["highway"](54.6,-2.8,54.7,-2.7)');
    expect(query.startsWith('[out:json][timeout:90];')).toBe(true);
    expect(query).toContain('out body;\n>;\nout skel qt;');
  });

  it('fills every occurrence of the area in a multi-part query', () => {
    const query = buildOverpassQuery('water', bbox);
    expect(query).not.toContain('{bbox}');
    expect(query.match(/\(54\.6,-2\.8,54\.7,-2\.7\)/g)).toHaveLength(4);
  });
});

describe('parseOverpass', () => {
  it('turns tagged ways in a road layer into lines, whether or not they close', () => {
    const result = parseOverpass(
      response(...square, way(10, [1, 2, 3], { highway: 'primary', name: 'High Street' }), way(11, [1, 2, 3, 4, 1], { highway: 'pedestrian' })),
      'roads',
    );
    expect(result.lines.map((l) => l.id)).toEqual([10, 11]);
    expect(result.lines[0]).toEqual({
      id: 10,
      tags: { highway: 'primary', name: 'High Street' },
      coordinates: [[0, 0], [1, 0], [1, 1]],
    });
    expect(result.polygons).toEqual([]);
  });

  it('keeps tagged nodes as points and uses untagged nodes only as geometry', () => {
    const result = parseOverpass(response(...square, node(5, 0.5, 0.5, { amenity: 'cafe', name: 'Brew' })), 'dining');
    expect(result.points).toEqual([{ id: 5, tags: { amenity: 'cafe', name: 'Brew' }, coordinate: [0.5, 0.5] }]);
  });

  it('drops a way whose nodes are missing, and a way with fewer than two usable points', () => {
    const result = parseOverpass(response(node(1, 0, 0), way(10, [1, 99], { highway: 'path' }), way(11, [98, 99], { highway: 'path' })), 'roads');
    expect(result.lines).toEqual([]);
  });

  it('makes closed ways in an area layer polygons, and open ones lines', () => {
    const result = parseOverpass(
      response(...square, way(10, [1, 2, 3, 4, 1], { building: 'yes' }), way(11, [1, 2, 3], { building: 'yes' })),
      'buildings',
    );
    expect(result.polygons).toEqual([{ id: 10, tags: { building: 'yes' }, rings: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }]);
    expect(result.lines.map((l) => l.id)).toEqual([11]);
  });

  it('keeps a named river as a line in a layer of areas', () => {
    const result = parseOverpass(response(...square, way(10, [1, 2, 3], { waterway: 'river', name: 'Eden' })), 'water');
    expect(result.lines.map((l) => l.tags['name'])).toEqual(['Eden']);
  });

  it('reads a closed outline in a point layer as one place at its centre', () => {
    const result = parseOverpass(response(...square, way(10, [1, 2, 3, 4, 1], { railway: 'station', name: 'Central' })), 'transport');
    expect(result.polygons).toEqual([]);
    expect(result.lines).toEqual([]);
    expect(result.points).toHaveLength(1);
    // [longitude, latitude]: the centre of the square, not [latitude, longitude].
    expect(result.points[0]!.coordinate[0]).toBeCloseTo(0.5, 9);
    expect(result.points[0]!.coordinate[1]).toBeCloseTo(0.5, 9);
  });

  describe('multipolygon relations', () => {
    // An outer ring in two halves, one of them drawn backwards, and a hole.
    const lake = [
      node(1, 0, 0), node(2, 0, 10), node(3, 10, 10), node(4, 10, 0),
      node(5, 4, 4), node(6, 4, 6), node(7, 6, 6), node(8, 6, 4),
    ];
    const ways = [
      way(100, [1, 2, 3]),
      way(101, [1, 4, 3]), // runs the other way round the ring
      way(102, [5, 6, 7, 8, 5]),
    ];
    const relation = {
      type: 'relation',
      id: 7,
      tags: { type: 'multipolygon', natural: 'water', name: 'The Lake' },
      members: [
        { type: 'way', ref: 100, role: 'outer' },
        { type: 'way', ref: 101, role: 'outer' },
        { type: 'way', ref: 102, role: 'inner' },
      ],
    };

    it('joins the pieces into one ring with its hole, and gives it a negative id', () => {
      const result = parseOverpass(response(...lake, ...ways, relation), 'water');
      expect(result.polygons).toHaveLength(1);
      const polygon = result.polygons[0]!;
      expect(polygon.id).toBe(-7);
      expect(polygon.tags['name']).toBe('The Lake');
      expect(polygon.rings).toHaveLength(2);
      const outer = polygon.rings[0]!;
      expect(outer[0]).toEqual(outer[outer.length - 1]);
      expect(new Set(outer.map((c) => c.join(','))).size).toBe(4);
    });

    it('does not draw the untagged member ways a second time', () => {
      const result = parseOverpass(response(...lake, ...ways, relation), 'water');
      expect(result.lines).toEqual([]);
      expect(result.polygons).toHaveLength(1);
    });

    it('numbers further outer rings from the relation id', () => {
      const second = [node(11, 20, 20), node(12, 20, 30), node(13, 30, 30), node(14, 30, 20)];
      const result = parseOverpass(
        response(...lake, ...second, ...ways, way(103, [11, 12, 13, 14, 11]), {
          ...relation,
          members: [...relation.members, { type: 'way', ref: 103, role: 'outer' }],
        }),
        'water',
      );
      expect(result.polygons.map((p) => p.id).sort((a, b) => a - b)).toEqual([-7001, -7]);
    });

    it('ignores relations in layers that are not made of areas, and relations that are not areas', () => {
      expect(parseOverpass(response(...lake, ...ways, relation), 'roads').polygons).toEqual([]);
      // A route is not an area, so nothing is assembled from it (relation polygons have negative ids).
      const route = { ...relation, tags: { type: 'route' } };
      expect(parseOverpass(response(...lake, ...ways, route), 'water').polygons.every((p) => p.id > 0)).toBe(true);
    });
  });

  it('refuses an answer that is not map data', () => {
    expect(() => parseOverpass({ remark: 'runtime error: Query timed out' }, 'roads')).toThrow(/not with map data/);
    expect(() => parseOverpass(null, 'roads')).toThrow();
  });
});

describe('assembleRings', () => {
  const a: [number, number] = [0, 0];
  const b: [number, number] = [1, 0];
  const c: [number, number] = [1, 1];
  const d: [number, number] = [0, 1];

  it('joins pieces in any order and direction', () => {
    const rings = assembleRings([[c, d], [b, c], [a, b], [a, d]]);
    expect(rings).toHaveLength(1);
    expect(rings[0]![0]).toEqual(rings[0]![rings[0]!.length - 1]);
    expect(rings[0]).toHaveLength(5);
  });

  it('closes a ring the edge of the area cut open, and drops scraps', () => {
    expect(assembleRings([[a, b, c, d]])[0]).toEqual([a, b, c, d, a]);
    expect(assembleRings([[a, b]])).toEqual([]);
  });

  it('keeps separate rings separate', () => {
    const far = (x: number): [number, number] => [x + 10, x + 10];
    const rings = assembleRings([[a, b, c, d, a], [far(0), far(1), far(2), far(0)]]);
    expect(rings).toHaveLength(2);
  });
});

describe('fetchLayerData', () => {
  const data = response(...square, way(10, [1, 2, 3], { highway: 'path' }));
  const ok = { ok: true, status: 200, json: async () => data };
  const fail = (status: number) => ({ ok: false, status, json: async () => ({}) });

  it('posts the query to the endpoint first and parses the answer', async () => {
    const calls: { url: string; body: string; method: string | undefined }[] = [];
    const fetchImpl: HttpFetch = async (url, init) => {
      calls.push({ url, body: init?.body ?? '', method: init?.method });
      return ok;
    };
    const result = await fetchLayerData('roads', bbox, { endpoint: 'https://overpass.example/api', fetchImpl });
    expect(result.lines).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://overpass.example/api');
    expect(calls[0]!.method).toBe('POST');
    expect(decodeURIComponent(calls[0]!.body.replace(/^data=/, ''))).toBe(buildOverpassQuery('roads', bbox));
  });

  it('falls back to the mirrors when a server is busy or unreachable', async () => {
    const urls: string[] = [];
    const fetchImpl: HttpFetch = async (url) => {
      urls.push(url);
      if (urls.length === 1) return fail(429);
      if (urls.length === 2) throw new Error('connection reset');
      return ok;
    };
    const result = await fetchLayerData('roads', bbox, { endpoint: 'https://busy.example/api', fetchImpl });
    expect(result.lines).toHaveLength(1);
    expect(urls).toEqual([
      'https://busy.example/api',
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
    ]);
  });

  it('does not try the same mirror twice', async () => {
    const urls: string[] = [];
    const fetchImpl: HttpFetch = async (url) => {
      urls.push(url);
      return fail(500);
    };
    await expect(
      fetchLayerData('roads', bbox, { endpoint: 'https://overpass-api.de/api/interpreter', fetchImpl }),
    ).rejects.toThrow(/answered 500/);
    expect(urls).toEqual(['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']);
  });

  it('reports the last failure when every server fails', async () => {
    const fetchImpl: HttpFetch = async () => {
      throw new Error('offline');
    };
    await expect(fetchLayerData('roads', bbox, { endpoint: 'https://x.example/api', fetchImpl })).rejects.toThrow('offline');
  });

  it('stops at once when cancelled, without trying more servers', async () => {
    let calls = 0;
    let aborted = false;
    const signal = {
      get aborted() {
        return aborted;
      },
      throwIfAborted() {
        if (aborted) throw new Error('cancelled');
      },
    };
    const fetchImpl: HttpFetch = async () => {
      calls++;
      aborted = true;
      throw new Error('aborted by the user');
    };
    await expect(fetchLayerData('roads', bbox, { endpoint: 'https://x.example/api', fetchImpl, signal })).rejects.toThrow('aborted');
    expect(calls).toBe(1);
  });
});
