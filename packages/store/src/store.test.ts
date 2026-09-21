import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { operationSchema, type Operation } from '@ghostapi/core';
import { GhostStore } from './store.js';

async function freshStore(): Promise<GhostStore> {
  const root = await mkdtemp(join(tmpdir(), 'ghost-store-'));
  const store = GhostStore.at(join(root, '.ghostapi'));
  await store.init();
  return store;
}

const operation: Operation = operationSchema.parse({
  id: 'op_1',
  name: 'createTodo',
  description: 'Create a todo.',
  verb: 'create',
  inputs: { type: 'object', properties: {}, required: [] },
  transport: {
    type: 'http',
    method: 'POST',
    urlTemplate: 'https://app.example.com/api/todos',
    pathParams: [],
    query: {},
    headers: {},
    bodyKind: 'none',
    successStatuses: [201],
  },
  auth: { strategy: 'browser-session', cookieNames: [] },
  confidence: 0.9,
  destructive: false,
  source: 'observed',
  createdAt: 1,
  updatedAt: 1,
});

describe('GhostStore', () => {
  let store: GhostStore;
  beforeEach(async () => {
    store = await freshStore();
  });

  it('creates a target and makes it the default', async () => {
    const target = await store.createTarget({ url: 'https://app.example.com/inbox' });
    expect(target.origin).toBe('https://app.example.com');
    expect((await store.config()).defaultTarget).toBe(target.slug);
  });

  it('round-trips operations through disk', async () => {
    const target = await store.createTarget({ url: 'https://app.example.com' });
    await store.saveOperation(target.slug, operation);
    expect(await store.readOperation(target.slug, 'createTodo')).toEqual(operation);
    expect((await store.listOperations(target.slug)).map((item) => item.name)).toEqual(['createTodo']);
  });

  it('explains what is available when an operation is missing', async () => {
    const target = await store.createTarget({ url: 'https://app.example.com' });
    await store.saveOperation(target.slug, operation);
    await expect(store.requireOperation(target.slug, 'nope')).rejects.toMatchObject({
      code: 'operation_not_found',
      remedy: expect.stringContaining('createTodo'),
    });
  });

  it('appends observations without losing earlier ones', async () => {
    const target = await store.createTarget({ url: 'https://app.example.com' });
    const make = (id: string) => ({
      id,
      sessionId: 'sess_1',
      kind: 'network' as const,
      startedAt: 1,
      method: 'GET' as const,
      url: 'https://app.example.com/api/todos',
      origin: 'https://app.example.com',
      path: '/api/todos',
      query: {},
      requestHeaders: {},
      requestBodyKind: 'none' as const,
      responseHeaders: {},
      responseBodyKind: 'none' as const,
      redactionCount: 0,
      sensitiveRequestHeaders: [],
    });
    await store.appendObservations(target.slug, 'sess_1', [make('obs_1')]);
    await store.appendObservations(target.slug, 'sess_1', [make('obs_2')]);
    const all = await store.readSessionObservations(target.slug, 'sess_1');
    expect(all.map((item) => item.id)).toEqual(['obs_1', 'obs_2']);
  });

  it('survives one corrupt line in an observation log', async () => {
    const target = await store.createTarget({ url: 'https://app.example.com' });
    const file = join(store.paths.targetsDir, target.slug, 'observations', 'sess_x.ndjson');
    await writeFile(file, 'not json\n{"broken":true}\n', 'utf8');
    await expect(store.readSessionObservations(target.slug, 'sess_x')).resolves.toEqual([]);
  });

  it('refuses a corrupt operation file rather than returning nonsense', async () => {
    const target = await store.createTarget({ url: 'https://app.example.com' });
    await writeFile(join(store.paths.targetsDir, target.slug, 'operations', 'bad.json'), '{oops', 'utf8');
    await expect(store.listOperations(target.slug)).rejects.toThrow(/valid JSON/i);
  });

  it('stores session material separately from the target and out of exports', async () => {
    const target = await store.createTarget({ url: 'https://app.example.com' });
    await store.saveOperation(target.slug, operation);
    await store.writeAuth(target.slug, {
      origin: target.origin,
      updatedAt: 1,
      cookies: [
        { name: 'sid', value: 'super-secret', domain: 'app.example.com', path: '/', expires: -1, httpOnly: true, secure: false },
      ],
    });

    const bundle = await store.exportBundle(target.slug, 'test');
    expect(JSON.stringify(bundle)).not.toContain('super-secret');

    const targetFile = await readFile(join(store.paths.targetsDir, target.slug, 'target.json'), 'utf8');
    expect(targetFile).not.toContain('super-secret');
  });

  it('round-trips a target bundle into a clean workspace', async () => {
    const target = await store.createTarget({ url: 'https://app.example.com' });
    await store.saveOperation(target.slug, operation);
    const bundle = await store.exportBundle(target.slug, 'test');

    const other = await freshStore();
    const result = await other.importBundle(bundle);
    expect(result.operations).toBe(1);
    expect((await other.listOperations(result.slug)).map((item) => item.name)).toEqual(['createTodo']);
    expect(await other.readAuth(result.slug)).toBeUndefined();
  });

  it('rejects a slug that would escape the store directory', async () => {
    await expect(store.readTarget('../../etc')).rejects.toThrow(/path segment/i);
  });

  it('tells the user how to create a target when there is none', async () => {
    await expect(store.requireTarget()).rejects.toMatchObject({
      code: 'target_not_found',
      remedy: expect.stringContaining('ghostapi open'),
    });
  });
});
