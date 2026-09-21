import { describe, expect, it } from 'vitest';
import { operationSchema } from './operation.js';
import { targetBundleSchema, TARGET_BUNDLE_FORMAT, targetSchema } from './target.js';
import { networkObservationSchema } from './observation.js';

const operation = {
  id: 'op_1',
  name: 'createTodo',
  description: 'Create a todo.',
  entity: 'todo',
  verb: 'create',
  inputs: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
  transport: {
    type: 'http',
    method: 'POST',
    urlTemplate: 'https://example.com/api/todos',
    pathParams: [],
    query: {},
    headers: { 'content-type': { kind: 'literal', value: 'application/json' } },
    bodyKind: 'json',
    body: { kind: 'object', properties: { title: { kind: 'input', field: 'title' } } },
    successStatuses: [201],
  },
  auth: { strategy: 'browser-session', cookieNames: ['sid'] },
  confidence: 0.9,
  evidence: [{ kind: 'network', note: 'POST /api/todos → 201', at: 1 }],
  destructive: false,
  source: 'observed',
  createdAt: 1,
  updatedAt: 2,
};

describe('operation serialization', () => {
  it('round-trips through JSON without losing anything', () => {
    const parsed = operationSchema.parse(operation);
    const again = operationSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(again).toEqual(parsed);
  });

  it('rejects an operation name that is not a plain identifier', () => {
    expect(() => operationSchema.parse({ ...operation, name: 'create todo' })).toThrow();
    expect(() => operationSchema.parse({ ...operation, name: 'POST /api/todos' })).toThrow();
  });

  it('rejects unknown top-level keys rather than silently keeping them', () => {
    expect(() => operationSchema.parse({ ...operation, surprise: true })).toThrow();
  });

  it('applies documented defaults', () => {
    const parsed = operationSchema.parse(operation);
    expect(parsed.fallbacks).toEqual([]);
    expect(parsed.verified).toBe(false);
    expect(parsed.observationCount).toBe(0);
  });
});

describe('target bundle', () => {
  const target = targetSchema.parse({
    slug: 'demo',
    name: 'demo',
    origin: 'https://example.com',
    startUrl: 'https://example.com',
    createdAt: 1,
    updatedAt: 1,
  });

  it('round-trips', () => {
    const bundle = targetBundleSchema.parse({
      format: TARGET_BUNDLE_FORMAT,
      generator: 'ghostapi/test',
      exportedAt: 1,
      target,
      operations: [operationSchema.parse(operation)],
    });
    expect(targetBundleSchema.parse(JSON.parse(JSON.stringify(bundle)))).toEqual(bundle);
  });

  it('refuses a bundle from an unknown format version', () => {
    expect(() =>
      targetBundleSchema.parse({
        format: 999,
        generator: 'x',
        exportedAt: 1,
        target,
        operations: [],
      }),
    ).toThrow();
  });
});

describe('network observation', () => {
  it('defaults the collections it is safe to default', () => {
    const parsed = networkObservationSchema.parse({
      id: 'obs_1',
      sessionId: 'sess_1',
      kind: 'network',
      startedAt: 1,
      method: 'GET',
      url: 'https://example.com/api/todos',
      origin: 'https://example.com',
      path: '/api/todos',
    });
    expect(parsed.query).toEqual({});
    expect(parsed.requestHeaders).toEqual({});
    expect(parsed.sensitiveRequestHeaders).toEqual([]);
    expect(parsed.requestBodyKind).toBe('none');
  });
});

describe('transportChain', () => {
  const browser = { type: 'browser', startUrl: 'https://example.com', steps: [] };
  const http = operation.transport;

  it('tries the API before the browser regardless of storage order', async () => {
    const { transportChain } = await import('./operation.js');
    const parsed = operationSchema.parse({ ...operation, transport: http, fallbacks: [browser] });
    expect(transportChain(parsed).map((item) => item.type)).toEqual(['http', 'browser']);
  });

  it('reorders a browser-first operation that arrived from elsewhere', async () => {
    const { transportChain } = await import('./operation.js');
    const parsed = operationSchema.parse({ ...operation, transport: browser, fallbacks: [http] });
    expect(transportChain(parsed).map((item) => item.type)).toEqual(['http', 'browser']);
  });
});
