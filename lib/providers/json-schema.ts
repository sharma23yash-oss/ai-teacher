/**
 * Makes a zod-generated JSON Schema acceptable to every provider. Gemini
 * rejects the whole request ("invalid argument") on exclusiveMinimum, on the
 * +/-2^53 bounds zod adds to every integer, and on schemas carrying many
 * length/count constraints. Dropping them is safe: the prompt states the
 * counts, and zod still validates the reply in full.
 */
const UNSUPPORTED = new Set([
  "$schema",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
]);

export function providerSafeJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(providerSafeJsonSchema);
  if (typeof schema !== "object" || schema === null) return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (UNSUPPORTED.has(key)) continue;
    if ((key === "minimum" || key === "maximum") && typeof value === "number" && Math.abs(value) >= Number.MAX_SAFE_INTEGER) continue;
    out[key] = providerSafeJsonSchema(value);
  }
  return out;
}
