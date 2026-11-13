import { describe, expect, it } from 'vitest';
import { toNolliName } from './platform';

describe('toNolliName', () => {
  it('turns legacy and untitled names into .nolli names', () => {
    expect(toNolliName('Map.mapcraft')).toBe('Map.nolli');
    expect(toNolliName('/Users/example/Projects/Map.mapcraft')).toBe('Map.nolli');
    expect(toNolliName('Untitled')).toBe('Untitled.nolli');
    expect(toNolliName('Site Plan v2.mapcraft')).toBe('Site Plan v2.nolli');
  });

  it('leaves an existing .nolli name alone', () => {
    expect(toNolliName('Map.nolli')).toBe('Map.nolli');
    expect(toNolliName('Map.NOLLI')).toBe('Map.NOLLI');
  });
});
