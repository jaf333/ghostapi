import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startDemoTarget, type DemoServerHandle } from './server.js';
import { DEMO_CREDENTIALS } from './data.js';

let server: DemoServerHandle;
let cookie = '';

async function call(
  path: string,
  init: RequestInit & { authenticated?: boolean } = {},
): Promise<{ status: number; body: unknown; setCookie: string | null }> {
  const { authenticated = true, ...rest } = init;
  const response = await fetch(`${server.url}${path}`, {
    ...rest,
    headers: {
      ...(rest.body ? { 'content-type': 'application/json' } : {}),
      ...(authenticated && cookie ? { cookie } : {}),
      ...(rest.headers ?? {}),
    },
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text.length > 0 ? JSON.parse(text) : null,
    setCookie: response.headers.get('set-cookie'),
  };
}

beforeAll(async () => {
  server = await startDemoTarget(0);
});

afterAll(async () => {
  await server.close();
});

beforeEach(async () => {
  server.reset();
  const login = await call('/api/session', {
    method: 'POST',
    body: JSON.stringify(DEMO_CREDENTIALS),
    authenticated: false,
  });
  cookie = (login.setCookie ?? '').split(';')[0] ?? '';
});

describe('demo target API', () => {
  it('requires a session for todo endpoints', async () => {
    const result = await call('/api/todos', { authenticated: false });
    expect(result.status).toBe(401);
  });

  it('rejects bad credentials', async () => {
    const result = await call('/api/session', {
      method: 'POST',
      body: JSON.stringify({ email: DEMO_CREDENTIALS.email, password: 'wrong' }),
      authenticated: false,
    });
    expect(result.status).toBe(401);
  });

  it('creates a todo', async () => {
    const result = await call('/api/todos', {
      method: 'POST',
      body: JSON.stringify({ title: 'Buy milk', projectId: 'prj_home', priority: 'high' }),
    });
    expect(result.status).toBe(201);
    expect((result.body as { todo: { title: string } }).todo.title).toBe('Buy milk');
  });

  it('validates the input it advertises', async () => {
    expect(
      (await call('/api/todos', { method: 'POST', body: JSON.stringify({ title: '' }) })).status,
    ).toBe(400);
    expect(
      (
        await call('/api/todos', {
          method: 'POST',
          body: JSON.stringify({ title: 'x', priority: 'urgent' }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('/api/todos', {
          method: 'POST',
          body: JSON.stringify({ title: 'x', projectId: 'nope' }),
        })
      ).status,
    ).toBe(400);
  });

  it('searches, updates, archives and deletes', async () => {
    const created = await call('/api/todos', {
      method: 'POST',
      body: JSON.stringify({ title: 'Unique marker', projectId: 'prj_inbox', priority: 'low' }),
    });
    const id = (created.body as { todo: { id: string } }).todo.id;

    const found = await call('/api/todos?query=unique');
    expect((found.body as { total: number }).total).toBe(1);

    const updated = await call(`/api/todos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Renamed' }),
    });
    expect((updated.body as { todo: { title: string } }).todo.title).toBe('Renamed');

    const archived = await call(`/api/todos/${id}/archive`, { method: 'POST' });
    expect((archived.body as { todo: { archived: boolean } }).todo.archived).toBe(true);
    expect((await call('/api/todos?status=active&query=Renamed')).body).toMatchObject({ total: 0 });

    expect((await call(`/api/todos/${id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await call(`/api/todos/${id}`)).status).toBe(404);
  });

  it('serves a GraphQL endpoint that needs the same session', async () => {
    const anonymous = await call('/graphql', {
      method: 'POST',
      body: JSON.stringify({ query: 'query { projects { id } }' }),
      authenticated: false,
    });
    expect(anonymous.status).toBe(401);

    const result = await call('/graphql', {
      method: 'POST',
      body: JSON.stringify({ query: 'query Projects { projects { id name } }' }),
    });
    expect((result.body as { data: { projects: unknown[] } }).data.projects.length).toBeGreaterThan(
      0,
    );
  });

  it('serves the single-page app', async () => {
    const response = await fetch(server.url);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<title>Tasklet');
  });

  it('refuses to serve files outside its public directory', async () => {
    const response = await fetch(`${server.url}/../../package.json`);
    expect([403, 404]).toContain(response.status);
  });
});
