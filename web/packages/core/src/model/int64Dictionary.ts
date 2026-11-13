import { z } from 'zod';

/** Feature ids and dictionary keys are signed 64-bit integers in the macOS model. */
export const int64Schema = z
  .number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);

/**
 * JSONEncoder writes `[Int64: Value]` dictionaries as alternating keys and
 * values rather than JSON objects. Decode them to Maps so callers do not have
 * to manipulate that wire representation.
 */
export function int64DictionarySchema<Value extends z.ZodType>(valueSchema: Value) {
  return z
    .array(z.unknown())
    .superRefine((items, context) => {
      if (items.length % 2 !== 0) {
        context.addIssue({
          code: 'custom',
          message: 'An Int64 dictionary must contain alternating key/value items',
        });
      }

      for (let index = 0; index < items.length; index += 2) {
        const keyResult = int64Schema.safeParse(items[index]);
        if (!keyResult.success) {
          for (const issue of keyResult.error.issues) {
            context.addIssue({
              code: 'custom',
              path: [index, ...(issue.path ?? [])],
              message: issue.message,
            });
          }
        }

        const valueResult = valueSchema.safeParse(items[index + 1]);
        if (!valueResult.success) {
          for (const issue of valueResult.error.issues) {
            context.addIssue({
              code: 'custom',
              path: [index + 1, ...(issue.path ?? [])],
              message: issue.message,
            });
          }
        }
      }
    })
    .transform((items) => {
      const dictionary = new Map<number, z.output<Value>>();
      for (let index = 0; index < items.length; index += 2) {
        dictionary.set(items[index] as number, items[index + 1] as z.output<Value>);
      }
      return dictionary;
    });
}

/** Absent and null manual-edit dictionaries become empty during project loading. */
export function optionalInt64DictionarySchema<Value extends z.ZodType>(valueSchema: Value) {
  return int64DictionarySchema(valueSchema)
    .nullish()
    .transform(
      (dictionary) => dictionary ?? new Map<number, z.output<Value>>(),
    );
}

/** Convert a decoded dictionary back to JSONEncoder's alternating array form. */
export function flattenInt64Dictionary<Value>(
  dictionary: ReadonlyMap<number, Value>,
): Array<number | Value> {
  const items: Array<number | Value> = [];
  for (const [key, value] of dictionary) items.push(key, value);
  return items;
}
