import { describe, expect, it } from 'vitest';
import { targetSchema, type Target } from '@ghostapi/core';
import { inferOperations } from './infer-operations.js';
import { networkFixture, stateFixture, uiFixture } from './fixtures.js';

const target: Target = targetSchema.parse({
  slug: 'demo',
  name: 'demo',
  origin: 'https://app.example.com',
  startUrl: 'https://app.example.com',
  createdAt: 1,
  updatedAt: 1,
});

describe('inferOperations', () => {
  it('derives a named, typed operation from a UI action and its request', () => {
    const result = inferOperations({
      target,
      observations: [uiFixture(), networkFixture(), stateFixture()],
    });
    const operation = result.operations.find((item) => item.name === 'createTodo');
    expect(operation).toBeDefined();
    expect(operation?.verb).toBe('create');
    expect(operation?.transport.type).toBe('http');
    expect(operation?.inputs.properties?.title?.type).toBe('string');
    expect(operation?.inputs.required).toContain('title');
  });

  it('keeps a browser fallback derived from the recorded interaction', () => {
    const result = inferOperations({ target, observations: [uiFixture(), networkFixture()] });
    const operation = result.operations.find((item) => item.name === 'createTodo');
    expect(operation?.fallbacks[0]?.type).toBe('browser');
    const fallback = operation?.fallbacks[0];
    if (fallback?.type === 'browser') {
      const click = fallback.steps.find((step) => step.action === 'click');
      expect(click?.action === 'click' && click.selector).toBe(
        '#create-form button[type="submit"]',
      );
    }
  });

  it('does not make the browser fallback wait for network idle', () => {
    const result = inferOperations({ target, observations: [uiFixture(), networkFixture()] });
    const fallback = result.operations.find((item) => item.name === 'createTodo')?.fallbacks[0];
    if (fallback?.type === 'browser') {
      const settles = fallback.steps.filter(
        (step) => step.action === 'waitFor' && !step.selector && !step.urlContains,
      );
      expect(settles.length).toBeGreaterThan(0);
      for (const settle of settles) {
        expect(settle.action === 'waitFor' && settle.timeoutMs).toBeLessThanOrEqual(2_000);
      }
    }
  });

  it('records the UI trigger that produced the operation', () => {
    const result = inferOperations({ target, observations: [uiFixture(), networkFixture()] });
    const operation = result.operations.find((item) => item.name === 'createTodo');
    expect(operation?.uiTriggers[0]?.kind).toBe('submit');
  });

  it('skips an endpoint that was never observed succeeding', () => {
    const result = inferOperations({
      target,
      observations: [networkFixture({ status: 500, responseBody: { error: 'boom' } })],
    });
    expect(result.operations).toHaveLength(0);
    expect(result.skipped[0]?.reason).toMatch(/successful/);
  });

  it('ignores analytics traffic', () => {
    const result = inferOperations({
      target,
      observations: [
        networkFixture({
          path: '/analytics',
          url: 'https://app.example.com/analytics',
          status: 202,
        }),
      ],
    });
    expect(result.operations.map((operation) => operation.name)).not.toContain('createAnalytic');
  });

  it('marks a delete destructive and a list not', () => {
    const result = inferOperations({
      target,
      observations: [
        networkFixture({
          method: 'DELETE',
          path: '/api/todos/todo_9ab12c',
          url: 'https://app.example.com/api/todos/todo_9ab12c',
          requestBodyKind: 'none',
          requestBody: undefined,
          status: 204,
          responseBodyKind: 'none',
          responseBody: undefined,
        }),
        networkFixture({
          method: 'GET',
          path: '/api/todos',
          url: 'https://app.example.com/api/todos',
          requestBodyKind: 'none',
          requestBody: undefined,
          status: 200,
          responseBody: { todos: [] },
        }),
      ],
    });
    expect(result.operations.find((item) => item.name === 'deleteTodo')?.destructive).toBe(true);
    expect(result.operations.find((item) => item.name === 'listTodos')?.destructive).toBe(false);
  });

  it('infers cookie authentication for the origin, not for one request', () => {
    const result = inferOperations({
      target,
      observations: [
        networkFixture({ sensitiveRequestHeaders: ['cookie'] }),
        networkFixture({
          method: 'GET',
          path: '/api/projects',
          url: 'https://app.example.com/api/projects',
          requestBodyKind: 'none',
          requestBody: undefined,
          responseBody: { projects: [] },
          // Chrome missed the Cookie header on this one.
          sensitiveRequestHeaders: [],
        }),
      ],
    });
    expect(result.operations.find((item) => item.name === 'listProjects')?.auth.strategy).toBe(
      'browser-session',
    );
  });

  it('does not claim a sign-in request carries the session it creates', () => {
    const result = inferOperations({
      target,
      observations: [
        networkFixture({
          path: '/api/session',
          url: 'https://app.example.com/api/session',
          requestBody: { email: 'a@b.com' },
          status: 200,
          sensitiveRequestHeaders: [],
        }),
        networkFixture({ sensitiveRequestHeaders: ['cookie'] }),
      ],
    });
    expect(result.operations.find((item) => item.name === 'signIn')?.auth.strategy).toBe('none');
  });

  it('raises confidence with repetition but never reaches verified from observation alone', () => {
    const many = Array.from({ length: 12 }, () => networkFixture());
    const result = inferOperations({ target, observations: [uiFixture(), ...many] });
    const operation = result.operations.find((item) => item.name === 'createTodo');
    expect(operation?.confidence).toBeGreaterThan(0.8);
    expect(operation?.confidence).toBeLessThan(0.95);
    expect(operation?.verified).toBe(false);
  });

  it('preserves verification across re-derivation', () => {
    const first = inferOperations({ target, observations: [uiFixture(), networkFixture()] });
    const verified = {
      ...(first.operations[0] as never),
      verified: true,
    } as (typeof first.operations)[number];
    const second = inferOperations({
      target,
      observations: [uiFixture(), networkFixture()],
      existing: [verified],
    });
    expect(second.operations[0]?.verified).toBe(true);
    expect(second.operations[0]?.confidence).toBeGreaterThanOrEqual(0.97);
  });

  it('derives a GraphQL operation from the envelope, not the URL', () => {
    const result = inferOperations({
      target,
      observations: [
        networkFixture({
          path: '/api/data',
          url: 'https://app.example.com/api/data',
          requestBody: {
            query: 'mutation createTag($name: String!) { createTag(name: $name) { id } }',
            variables: { name: 'bug' },
          },
          graphql: {
            query: 'mutation createTag($name: String!) { createTag(name: $name) { id } }',
            operationName: 'createTag',
            operationType: 'mutation',
            variables: { name: 'bug' },
          },
          status: 200,
          responseBody: { data: { createTag: { id: 'tag_1' } } },
        }),
      ],
    });
    const operation = result.operations.find((item) => item.name === 'createTag');
    expect(operation?.transport.type).toBe('graphql');
    expect(operation?.inputs.properties?.name?.type).toBe('string');
  });

  it('never emits an operation whose transport binds an input the schema does not declare', () => {
    const result = inferOperations({ target, observations: [uiFixture(), networkFixture()] });
    for (const operation of result.operations) {
      const declared = new Set(Object.keys(operation.inputs.properties ?? {}));
      const transport = operation.transport;
      if (transport.type !== 'http') continue;
      for (const param of transport.pathParams) expect(declared.has(param)).toBe(true);
    }
  });
});

describe('regressions', () => {
  it('authenticates with any header the capture layer treats as a credential', () => {
    // x-session-token is redacted at capture but was not recognised here, so
    // the operation shipped with strategy "none" and could only ever 401.
    const result = inferOperations({
      target,
      observations: [networkFixture({ sensitiveRequestHeaders: ['x-session-token'] })],
    });
    const operation = result.operations.find((item) => item.name === 'createTodo');
    expect(operation?.auth).toMatchObject({ strategy: 'header', header: 'x-session-token' });
  });

  it('never freezes a credential-shaped header into a transport literal', () => {
    const result = inferOperations({
      target,
      observations: [
        networkFixture({
          requestHeaders: {
            'content-type': 'application/json',
            'x-vendor-token': 'shpat_1234567890abcdef1234567890abcdef',
            'x-api-version': '2026-01-01',
          },
        }),
        networkFixture({
          requestHeaders: {
            'content-type': 'application/json',
            'x-vendor-token': 'shpat_1234567890abcdef1234567890abcdef',
            'x-api-version': '2026-01-01',
          },
        }),
      ],
    });
    const operation = result.operations.find((item) => item.name === 'createTodo');
    const serialized = JSON.stringify(operation?.transport);
    expect(serialized).not.toContain('shpat_');
    // A harmless version pin is still replayed.
    expect(serialized).toContain('2026-01-01');
  });
});

describe('operation consistency', () => {
  it('declares every input its transport reads', () => {
    const result = inferOperations({
      target,
      observations: [
        uiFixture(),
        networkFixture(),
        networkFixture({
          method: 'PATCH',
          path: '/api/todos/todo_9ab12c',
          url: 'https://app.example.com/api/todos/todo_9ab12c',
          requestBody: { title: 'x' },
          status: 200,
        }),
      ],
    });
    expect(result.operations.length).toBeGreaterThan(0);
    for (const operation of result.operations) {
      const declared = new Set(Object.keys(operation.inputs.properties ?? {}));
      const transport = operation.transport;
      if (transport.type !== 'http') continue;
      const bound = [
        ...transport.pathParams,
        ...Object.values(transport.query)
          .filter((binding) => binding.kind === 'input')
          .map((binding) => (binding as { field: string }).field),
      ];
      for (const field of bound) {
        expect(declared.has(field), `${operation.name} binds undeclared input "${field}"`).toBe(
          true,
        );
      }
    }
  });
});
