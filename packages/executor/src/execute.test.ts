import { describe, expect, it } from 'vitest';
import { isGhostError, operationSchema, type GhostError, type Operation } from '@ghostapi/core';
import { executeOperation } from './execute.js';

function operation(overrides: Record<string, unknown> = {}): Operation {
  return operationSchema.parse({
    id: 'op_x',
    name: 'signIn',
    description: 'Authenticate.',
    entity: 'session',
    verb: 'auth',
    inputs: {
      type: 'object',
      properties: { email: { type: 'string' }, password: { type: 'string' } },
      required: ['email', 'password'],
      additionalProperties: false,
    },
    transport: {
      type: 'http',
      method: 'POST',
      urlTemplate: 'https://app.example.com/api/session',
      pathParams: [],
      query: {},
      headers: {},
      bodyKind: 'json',
      body: {
        kind: 'object',
        properties: {
          email: { kind: 'input', field: 'email' },
          password: { kind: 'input', field: 'password' },
        },
      },
      successStatuses: [200],
    },
    auth: { strategy: 'none' },
    confidence: 0.9,
    destructive: false,
    source: 'observed',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  });
}

function stubFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

describe('executeOperation', () => {
  it('returns data and a trace on success', async () => {
    const result = await executeOperation({
      operation: operation(),
      inputs: { email: 'a@b.com', password: 'hunter2' },
      auth: {},
      fetchImpl: stubFetch(200, { user: { id: 'usr_1' } }),
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.trace.spans.map((span) => span.name)).toContain('response.received');
  });

  it('never writes a request value into a trace', async () => {
    const result = await executeOperation({
      operation: operation(),
      inputs: { email: 'a@b.com', password: 'hunter2' },
      auth: {},
      fetchImpl: stubFetch(200, { ok: true }),
    });
    expect(JSON.stringify(result.trace)).not.toContain('hunter2');
  });

  it('redacts a credential the server echoed back in an error', async () => {
    // A failing endpoint frequently reflects the submitted payload. Nothing has
    // scrubbed this response — it is live, not captured.
    try {
      await executeOperation({
        operation: operation(),
        inputs: { email: 'a@b.com', password: 'hunter2' },
        auth: {},
        fetchImpl: stubFetch(400, {
          error: 'invalid login',
          submitted: { email: 'a@b.com', password: 'hunter2' },
        }),
      });
      throw new Error('expected the execution to fail');
    } catch (error) {
      expect(isGhostError(error)).toBe(true);
      const ghost = error as GhostError;
      expect(ghost.detail).not.toContain('hunter2');
      expect(ghost.detail).toContain('__ghostapi_redacted__');
      expect(JSON.stringify(ghost.toJSON())).not.toContain('hunter2');
    }
  });

  it('explains an expired session rather than dumping a 401', async () => {
    try {
      await executeOperation({
        operation: operation({ auth: { strategy: 'browser-session', cookieNames: [] } }),
        inputs: { email: 'a@b.com', password: 'x' },
        auth: {
          cookies: [
            { name: 'sid', value: 'abc', domain: 'app.example.com', path: '/', expires: -1 },
          ],
        },
        fetchImpl: stubFetch(401, { error: 'Not authenticated' }),
      });
      throw new Error('expected the execution to fail');
    } catch (error) {
      const ghost = error as GhostError;
      expect(ghost.code).toBe('auth_expired');
      expect(ghost.remedy).toMatch(/ghostapi open/);
    }
  });

  it('refuses a destructive operation without confirmation, before sending anything', async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await expect(
      executeOperation({
        operation: operation({ name: 'deleteTodo', verb: 'delete', destructive: true }),
        inputs: { email: 'a@b.com', password: 'x' },
        auth: {},
        fetchImpl: spy,
      }),
    ).rejects.toMatchObject({ code: 'confirmation_required' });
    expect(called).toBe(false);
  });

  it('validates input before sending anything', async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await expect(
      executeOperation({
        operation: operation(),
        inputs: { email: 'a@b.com' },
        auth: {},
        fetchImpl: spy,
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(called).toBe(false);
  });

  it('reports the preferred transport failure, not the fallback consequence', async () => {
    const withFallback = operation({
      fallbacks: [{ type: 'browser', startUrl: 'https://app.example.com', steps: [] }],
    });
    try {
      await executeOperation({
        operation: withFallback,
        inputs: { email: 'a@b.com', password: 'x' },
        auth: {},
        fetchImpl: stubFetch(500, { error: 'boom' }),
      });
      throw new Error('expected the execution to fail');
    } catch (error) {
      const ghost = error as GhostError;
      expect(ghost.title).toBe('Operation execution failed');
      expect(ghost.detail).toContain('500');
      expect((ghost.context as { attempts: unknown[] }).attempts).toHaveLength(2);
    }
  });
});
