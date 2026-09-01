import type { ZodTypeAny } from 'zod';

/**
 * Which fields of a form schema must actually be filled in.
 *
 * Asked of the schema rather than declared per form, because a hand-maintained list of required
 * fields is a second source of truth that drifts the moment somebody makes a field optional —
 * and the drift is silent and in the wrong direction: the form goes on marking a field required
 * that the API is happy to accept without, or worse, stops marking one that it still rejects.
 *
 * "Required" here means *the schema will refuse it empty*: neither optional nor nullable. A
 * `.nullable()` field is a real answer of "none" — the requisition's project is the standing
 * example — so it is not marked, which is the same call D-006 made for that field by hand.
 *
 * Unwraps `ZodEffects`, because a schema carrying a `.refine()` or `.superRefine()` has no
 * `.shape` of its own and several of this app's forms cross-validate two fields that way.
 */
export function requiredFields(schema: ZodTypeAny): ReadonlySet<string> {
  const shape = shapeOf(schema);
  if (!shape) return new Set();

  const required = new Set<string>();
  for (const [key, field] of Object.entries(shape)) {
    if (!field.isOptional() && !field.isNullable()) required.add(key);
  }
  return required;
}

function shapeOf(schema: ZodTypeAny): Record<string, ZodTypeAny> | null {
  // Walk down through however many effects wrap the object. A bounded loop rather than
  // recursion so a self-referential schema cannot hang the render that called this.
  let current: ZodTypeAny = schema;
  for (let depth = 0; depth < 10; depth++) {
    const def = current._def as { typeName?: string; schema?: ZodTypeAny; shape?: unknown };
    if (typeof def?.shape === 'function') {
      return (def.shape as () => Record<string, ZodTypeAny>)();
    }
    if (def?.schema) {
      current = def.schema;
      continue;
    }
    return null;
  }
  return null;
}
