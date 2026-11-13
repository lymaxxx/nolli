import type { z } from 'zod';

/** Swift optional properties accept both missing and null values. */
export function optionalSchema<Schema extends z.ZodType>(schema: Schema) {
  return schema.nullish();
}
