import { REDACTED, type JsonSchema, type JsonSchemaType } from '@ghostapi/core';

export interface InferenceOptions {
  /** Minimum samples before a set of string values may become an enum. */
  readonly minSamplesForEnum: number;
  /** Maximum distinct values an enum may hold. */
  readonly maxEnumSize: number;
  /** Longest string value still eligible to be part of an enum. */
  readonly maxEnumValueLength: number;
}

export const DEFAULT_INFERENCE_OPTIONS: InferenceOptions = {
  minSamplesForEnum: 3,
  maxEnumSize: 6,
  maxEnumValueLength: 32,
};

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const URI = /^https?:\/\/\S+$/;

function formatOf(values: readonly string[]): string | undefined {
  if (values.length === 0) return undefined;
  if (values.every((value) => ISO_DATE_TIME.test(value))) return 'date-time';
  if (values.every((value) => ISO_DATE.test(value))) return 'date';
  if (values.every((value) => UUID.test(value))) return 'uuid';
  if (values.every((value) => EMAIL.test(value))) return 'email';
  if (values.every((value) => URI.test(value))) return 'uri';
  return undefined;
}

function typeOf(value: unknown): JsonSchemaType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'boolean':
      return 'boolean';
    case 'number':
      return Number.isInteger(value) ? 'integer' : 'number';
    default:
      return 'object';
  }
}

/**
 * Infers a JSON Schema from several samples of the same value.
 *
 * The rules that matter:
 * - A key is required only if every sample has it. One sample therefore never
 *   produces an optional field — it produces an all-required schema, which is
 *   honest about what we have actually seen.
 * - An enum needs repetition. Deriving `priority: "high"` as an enum from a
 *   single request would be a guess dressed up as a type.
 * - A redacted leaf keeps its type and is never turned into an enum or example.
 */
export function inferSchema(
  samples: readonly unknown[],
  options: InferenceOptions = DEFAULT_INFERENCE_OPTIONS,
): JsonSchema {
  const present = samples.filter((sample) => sample !== undefined);
  if (present.length === 0) return {};

  const types = new Set(present.map(typeOf));
  const nullable = types.delete('null') && types.size > 0;
  const remaining = [...types];

  if (remaining.length === 0) return { type: 'null' };

  if (remaining.length > 1) {
    // Integer plus number is one numeric type, not a union.
    if (remaining.length === 2 && remaining.includes('integer') && remaining.includes('number')) {
      return { type: 'number', ...(nullable ? { nullable: true } : {}) };
    }
    return { type: remaining.sort(), ...(nullable ? { nullable: true } : {}) };
  }

  const type = remaining[0] as JsonSchemaType;
  const nullableFlag = nullable ? { nullable: true } : {};

  if (type === 'object') {
    const objects = present.filter(
      (sample): sample is Record<string, unknown> =>
        typeof sample === 'object' && sample !== null && !Array.isArray(sample),
    );
    const keys = new Set<string>();
    for (const object of objects) for (const key of Object.keys(object)) keys.add(key);
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const key of [...keys].sort()) {
      const childSamples = objects.map((object) => object[key]);
      const definedCount = childSamples.filter((value) => value !== undefined).length;
      properties[key] = inferSchema(childSamples, options);
      if (definedCount === objects.length) required.push(key);
    }
    return { type: 'object', properties, required, additionalProperties: false, ...nullableFlag };
  }

  if (type === 'array') {
    const arrays = present.filter((sample): sample is unknown[] => Array.isArray(sample));
    const items = arrays.flat();
    return {
      type: 'array',
      items: items.length > 0 ? inferSchema(items, options) : {},
      ...nullableFlag,
    };
  }

  if (type === 'string') {
    const strings = present.filter((value): value is string => typeof value === 'string');
    const real = strings.filter((value) => value !== REDACTED);
    if (real.length === 0) {
      return { type: 'string', description: 'redacted credential', ...nullableFlag };
    }
    const distinct = [...new Set(real)];
    const eligibleForEnum =
      real.length >= options.minSamplesForEnum &&
      distinct.length >= 2 &&
      distinct.length <= options.maxEnumSize &&
      distinct.length < real.length &&
      distinct.every((value) => value.length > 0 && value.length <= options.maxEnumValueLength);
    if (eligibleForEnum) {
      return { type: 'string', enum: [...distinct].sort(), ...nullableFlag };
    }
    const format = formatOf(real);
    return {
      type: 'string',
      ...(format ? { format } : {}),
      examples: [real[0] as string],
      ...nullableFlag,
    };
  }

  const scalars = present.filter((value) => value !== null);
  return { type, examples: scalars.slice(0, 1), ...nullableFlag };
}

/** Merges a second schema into a first without losing evidence. */
export function mergeSchemas(a: JsonSchema, b: JsonSchema): JsonSchema {
  if (Object.keys(a).length === 0) return b;
  if (Object.keys(b).length === 0) return a;
  if (a.type === 'object' && b.type === 'object') {
    const properties: Record<string, JsonSchema> = { ...a.properties };
    for (const [key, schema] of Object.entries(b.properties ?? {})) {
      const existing = properties[key];
      properties[key] = existing ? mergeSchemas(existing, schema) : schema;
    }
    const required = (a.required ?? []).filter((key) => (b.required ?? []).includes(key));
    return { type: 'object', properties, required, additionalProperties: false };
  }
  if (a.type === b.type) {
    const enumA = a.enum;
    const enumB = b.enum;
    if (enumA && enumB) {
      return { ...a, enum: [...new Set([...enumA, ...enumB])].sort() };
    }
    return a;
  }
  const types = new Set(
    [a.type, b.type].flatMap((type) => (Array.isArray(type) ? type : type ? [type] : [])),
  );
  return { type: [...types].sort() };
}

/** Restricts a schema to the top-level properties an operation actually binds. */
export function pickProperties(schema: JsonSchema, keys: readonly string[]): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  for (const key of keys) {
    const child = schema.properties?.[key];
    if (child) properties[key] = child;
  }
  return {
    type: 'object',
    properties,
    required: (schema.required ?? []).filter((key) => keys.includes(key)),
    additionalProperties: false,
  };
}
