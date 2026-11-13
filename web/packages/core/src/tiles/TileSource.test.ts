import { describe, expect, it } from 'vitest';
import { OSM_STANDARD, tileUrl, type RasterXYZSource } from './TileSource';

describe('tileUrl', () => {
  it('builds OpenStreetMap URLs', () => {
    expect(tileUrl(OSM_STANDARD, 17, 64500, 41800)).toBe(
      'https://tile.openstreetmap.org/17/64500/41800.png',
    );
  });

  it('wraps x around the antimeridian and rejects y out of range', () => {
    expect(tileUrl(OSM_STANDARD, 2, -1, 0)).toBe('https://tile.openstreetmap.org/2/3/0.png');
    expect(() => tileUrl(OSM_STANDARD, 2, 0, 4)).toThrow(RangeError);
  });

  it('supports keyed providers with subdomains', () => {
    const keyed: RasterXYZSource = {
      ...OSM_STANDARD,
      id: 'example',
      name: 'Example',
      urlTemplate: 'https://{s}.tiles.example.com/{z}/{x}/{y}{r}.png?key={key}',
      subdomains: ['a', 'b'],
    };
    expect(() => tileUrl(keyed, 1, 0, 0)).toThrow(/API key/);
    expect(tileUrl({ ...keyed, apiKey: 'k 1' }, 1, 1, 0)).toBe(
      'https://b.tiles.example.com/1/1/0.png?key=k%201',
    );
  });
});
