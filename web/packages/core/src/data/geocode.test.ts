import { describe, expect, it } from 'vitest';
import { parseGeocode, searchPlaces } from './geocode';
import type { HttpFetch } from './overpass';

const answer = [
  {
    display_name: 'Penrith, Westmorland and Furness, Cumbria, England, United Kingdom',
    lat: '54.6641',
    lon: '-2.7533',
    boundingbox: ['54.6469', '54.6791', '-2.7808', '-2.7160'],
  },
  { display_name: 'No coordinates here' },
  { display_name: 'Bad box', lat: '1', lon: '2', boundingbox: ['x', 'y', 'z', 'w'] },
];

describe('parseGeocode', () => {
  it('reads strings as numbers and the box as south, north, west, east', () => {
    const [penrith] = parseGeocode(answer);
    expect(penrith).toEqual({
      displayName: 'Penrith, Westmorland and Furness, Cumbria, England, United Kingdom',
      shortName: 'Penrith',
      lat: 54.6641,
      lon: -2.7533,
      boundingBox: { minLat: 54.6469, minLon: -2.7808, maxLat: 54.6791, maxLon: -2.716 },
    });
  });

  it('skips entries it cannot use and keeps a place whose box is bad, without the box', () => {
    const results = parseGeocode(answer);
    expect(results.map((r) => r.shortName)).toEqual(['Penrith', 'Bad box']);
    expect(results[1]!.boundingBox).toBeUndefined();
  });

  it('copes with something that is not a list', () => {
    expect(parseGeocode({ error: 'x' })).toEqual([]);
    expect(parseGeocode(null)).toEqual([]);
  });
});

describe('searchPlaces', () => {
  it('asks for five results, encodes the query, and parses the answer', async () => {
    const urls: string[] = [];
    const fetchImpl: HttpFetch = async (url) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => answer };
    };
    const results = await searchPlaces('  St Andrew & Co  ', { fetchImpl });
    expect(results).toHaveLength(2);
    expect(urls).toEqual(['https://nominatim.openstreetmap.org/search?q=St%20Andrew%20%26%20Co&format=json&limit=5']);
  });

  it('does not ask the server about an empty search', async () => {
    let calls = 0;
    const fetchImpl: HttpFetch = async () => {
      calls++;
      return { ok: true, status: 200, json: async () => [] };
    };
    expect(await searchPlaces('   ', { fetchImpl })).toEqual([]);
    expect(calls).toBe(0);
  });

  it('says so when the server refuses', async () => {
    const fetchImpl: HttpFetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
    await expect(searchPlaces('Penrith', { fetchImpl })).rejects.toThrow(/429/);
  });
});
