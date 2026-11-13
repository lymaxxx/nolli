import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { flattenInt64Dictionary, int64DictionarySchema } from './int64Dictionary';

const vectorSchema = z.tuple([z.number(), z.number()]);
const offsetsSchema = int64DictionarySchema(vectorSchema);

describe('Int64 dictionary coding', () => {
  it('decodes JSONEncoder flat arrays, including negative feature ids', () => {
    const offsets = offsetsSchema.parse([65410291, [1.5, -2], -65410292, [0, 4]]);

    expect(offsets).toEqual(
      new Map([
        [65410291, [1.5, -2]],
        [-65410292, [0, 4]],
      ]),
    );
    expect(flattenInt64Dictionary(offsets)).toEqual([
      65410291,
      [1.5, -2],
      -65410292,
      [0, 4],
    ]);
  });

  it('rejects incomplete pairs and non-integer keys', () => {
    expect(() => offsetsSchema.parse([1, [0, 0], 2])).toThrow(
      /alternating key\/value items/,
    );
    expect(() => offsetsSchema.parse(['1', [0, 0]])).toThrow();
    expect(() => offsetsSchema.parse([1.5, [0, 0]])).toThrow();
  });

  it('reports invalid values at their array position', () => {
    const result = offsetsSchema.safeParse([5, [1, 'not a number']]);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual([1, 1]);
  });

  it('rejects integers that JavaScript cannot represent exactly', () => {
    expect(() => offsetsSchema.parse([Number.MAX_SAFE_INTEGER + 1, [0, 0]])).toThrow();
  });
});
