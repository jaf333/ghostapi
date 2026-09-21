import {
  defaultRedactor,
  REDACTED,
  type BodyKind,
  type HeaderBinding,
  type HttpTransport,
  type JsonSchema,
  type NetworkObservation,
  type ValueBinding,
} from '@ghostapi/core';
import type { PathTemplate } from './path-template.js';

/** Non-sensitive custom headers worth replaying, e.g. an API version pin. */
const REPLAYABLE_HEADER_PREFIXES = ['x-', 'accept-version', 'api-version'];
const NEVER_REPLAY = new Set([
  'x-requested-with',
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-real-ip',
  'x-csrf-token',
  'x-xsrf-token',
]);

export interface BodyBindingResult {
  readonly binding: ValueBinding | undefined;
  /** Top-level body keys bound to operation inputs. */
  readonly inputFields: string[];
  /** Body keys pinned to a constant because every sample agreed. */
  readonly literals: string[];
}

/**
 * Turns observed request bodies into a binding tree.
 *
 * A key becomes an input when the caller plausibly controls it. A key becomes a
 * literal only when several samples agreed on one value *and* nothing the user
 * typed produced it — otherwise GhostAPI would silently freeze a field the
 * caller needs to set.
 */
export function buildBodyBinding(
  bodies: readonly unknown[],
  userEnteredValues: readonly string[],
  userControlledFields: readonly string[] = [],
): BodyBindingResult {
  const objects = bodies.filter(
    (body): body is Record<string, unknown> =>
      typeof body === 'object' && body !== null && !Array.isArray(body),
  );
  if (objects.length === 0) {
    return { binding: undefined, inputFields: [], literals: [] };
  }

  const keys = [...new Set(objects.flatMap((body) => Object.keys(body)))].sort();
  const properties: Record<string, ValueBinding> = {};
  const inputFields: string[] = [];
  const literals: string[] = [];
  const entered = userEnteredValues.map((value) => value.toLowerCase());
  const controlled = new Set(userControlledFields);

  for (const key of keys) {
    const values = objects.map((body) => body[key]).filter((value) => value !== undefined);
    const distinct = new Set(values.map((value) => JSON.stringify(value)));
    const scalarValue = values[0];
    const looksUserSupplied =
      typeof scalarValue === 'string' && entered.includes(scalarValue.toLowerCase());
    const constant =
      objects.length >= 2 &&
      distinct.size === 1 &&
      !looksUserSupplied &&
      // A field the user can set in the UI stays an input even if every sample
      // happened to use the same value.
      !controlled.has(key) &&
      typeof scalarValue !== 'object';

    if (constant) {
      properties[key] = { kind: 'literal', value: scalarValue };
      literals.push(key);
    } else {
      properties[key] = { kind: 'input', field: key };
      inputFields.push(key);
    }
  }

  return { binding: { kind: 'object', properties }, inputFields, literals };
}

export interface QueryBindingResult {
  readonly query: Record<string, ValueBinding>;
  readonly inputFields: string[];
}

export function buildQueryBinding(
  observations: readonly NetworkObservation[],
  userControlledFields: readonly string[] = [],
): QueryBindingResult {
  const controlled = new Set(userControlledFields);
  const keys = [
    ...new Set(observations.flatMap((observation) => Object.keys(observation.query))),
  ].sort();
  const query: Record<string, ValueBinding> = {};
  const inputFields: string[] = [];
  for (const key of keys) {
    const values = observations
      .map((observation) => observation.query[key])
      .filter((value): value is string => value !== undefined);
    if (values.some((value) => value === REDACTED)) continue;
    const distinct = new Set(values);
    if (
      observations.length >= 2 &&
      distinct.size === 1 &&
      values.length === observations.length &&
      !controlled.has(key)
    ) {
      query[key] = { kind: 'literal', value: values[0] };
      continue;
    }
    query[key] = { kind: 'input', field: key };
    inputFields.push(key);
  }
  return { query, inputFields };
}

export function buildHeaderBindings(
  observations: readonly NetworkObservation[],
  bodyKind: BodyKind,
): Record<string, HeaderBinding> {
  const headers: Record<string, HeaderBinding> = {};
  if (bodyKind === 'json') headers['content-type'] = { kind: 'literal', value: 'application/json' };
  if (bodyKind === 'form') {
    headers['content-type'] = { kind: 'literal', value: 'application/x-www-form-urlencoded' };
  }
  headers.accept = { kind: 'literal', value: 'application/json, text/plain, */*' };

  const counts = new Map<string, Map<string, number>>();
  for (const observation of observations) {
    for (const [name, value] of Object.entries(observation.requestHeaders)) {
      if (value === REDACTED || NEVER_REPLAY.has(name)) continue;
      if (!REPLAYABLE_HEADER_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
      // Defence in depth. Capture should already have redacted anything
      // credential-shaped; a header that reaches here still looking like one
      // must not be frozen into an operation that gets exported.
      if (defaultRedactor.isSensitiveHeader(name) || defaultRedactor.isSensitiveKey(name)) continue;
      if (defaultRedactor.matchSensitiveValue(value)) continue;
      const bucket = counts.get(name) ?? new Map<string, number>();
      bucket.set(value, (bucket.get(value) ?? 0) + 1);
      counts.set(name, bucket);
    }
  }
  for (const [name, values] of counts) {
    if (values.size !== 1) continue;
    const [value] = [...values.keys()];
    if (value !== undefined) headers[name] = { kind: 'literal', value };
  }
  return headers;
}

export interface HttpTransportInput {
  readonly template: PathTemplate;
  readonly origin: string;
  readonly method: NetworkObservation['method'];
  readonly bodyKind: BodyKind;
  readonly bodyBinding: ValueBinding | undefined;
  readonly query: Record<string, ValueBinding>;
  readonly headers: Record<string, HeaderBinding>;
  readonly successStatuses: readonly number[];
}

export function buildHttpTransport(input: HttpTransportInput): HttpTransport {
  return {
    type: 'http',
    method: input.method,
    urlTemplate: `${input.origin}${input.template.template}`,
    pathParams: [...input.template.params],
    query: input.query,
    headers: input.headers,
    bodyKind: input.bodyBinding ? input.bodyKind : 'none',
    ...(input.bodyBinding ? { body: input.bodyBinding } : {}),
    successStatuses: [...new Set(input.successStatuses)].sort((a, b) => a - b),
  };
}

/** Assembles the operation's input schema from path, query and body evidence. */
export function buildInputSchema(parts: {
  pathParams: readonly string[];
  bodySchema: JsonSchema;
  bodyInputFields: readonly string[];
  querySchema: JsonSchema;
  queryInputFields: readonly string[];
}): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const param of parts.pathParams) {
    properties[param] = { type: 'string', description: 'path parameter' };
    required.push(param);
  }
  for (const field of parts.bodyInputFields) {
    const schema = parts.bodySchema.properties?.[field];
    if (!schema) continue;
    properties[field] = schema;
    if ((parts.bodySchema.required ?? []).includes(field)) required.push(field);
  }
  for (const field of parts.queryInputFields) {
    if (properties[field]) continue;
    properties[field] = parts.querySchema.properties?.[field] ?? { type: 'string' };
    if ((parts.querySchema.required ?? []).includes(field)) required.push(field);
  }

  return {
    type: 'object',
    properties,
    required: [...new Set(required)].sort(),
    additionalProperties: false,
  };
}
