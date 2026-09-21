import { describe, expect, it } from 'vitest';
import { operationSchema, type Operation } from '@ghostapi/core';
import { prepareHttpRequest } from '@ghostapi/executor';
// The exported runtime is a separate, dependency-free implementation so that
// generated artifacts stand alone. That duplication is only safe if the two
// agree, so this test pins them together.
import { fillUrlTemplate, resolveBinding } from '../templates/runtime.mjs';

function operation(overrides: Record<string, unknown> = {}): Operation {
  return operationSchema.parse({
    id: 'op_x',
    name: 'updateTodo',
    description: 'Update a todo.',
    entity: 'todo',
    verb: 'update',
    inputs: {
      type: 'object',
      properties: {
        todoId: { type: 'string', description: 'path parameter' },
        title: { type: 'string' },
        done: { type: 'boolean' },
        page: { type: 'string' },
      },
      required: ['todoId'],
      additionalProperties: false,
    },
    transport: {
      type: 'http',
      method: 'PATCH',
      urlTemplate: 'https://app.example.com/api/todos/{todoId}',
      pathParams: ['todoId'],
      query: { page: { kind: 'input', field: 'page' }, source: { kind: 'literal', value: 'web' } },
      headers: { 'content-type': { kind: 'literal', value: 'application/json' } },
      bodyKind: 'json',
      body: {
        kind: 'object',
        properties: {
          title: { kind: 'input', field: 'title' },
          done: { kind: 'input', field: 'done' },
          origin: { kind: 'literal', value: 'ghostapi' },
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

/** Mirrors what the generated runtime does, using only its own exports. */
function buildWithGeneratedRuntime(op: Operation, inputs: Record<string, unknown>) {
  const transport = op.transport;
  if (transport.type !== 'http') throw new Error('http only');
  const url = new URL(fillUrlTemplate(transport.urlTemplate, transport.pathParams, inputs));
  for (const [key, binding] of Object.entries(transport.query)) {
    const value = resolveBinding(binding, inputs);
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  const body = transport.body ? JSON.stringify(resolveBinding(transport.body, inputs)) : undefined;
  return { url: url.toString(), body };
}

const inputCases: Record<string, unknown>[] = [
  { todoId: 'todo_1', title: 'Buy bread', done: true, page: '2' },
  { todoId: 'todo_2', title: 'Only a title' },
  { todoId: 'todo 3/4', done: false },
  { todoId: 'todo_5', title: '', page: '' },
];

describe('generated runtime parity with the GhostAPI executor', () => {
  for (const inputs of inputCases) {
    it(`builds the same request for ${JSON.stringify(inputs)}`, () => {
      const op = operation();
      const viaExecutor = prepareHttpRequest(
        op.transport as Extract<Operation['transport'], { type: 'http' }>,
        inputs,
        {},
        op.auth,
      );
      const viaGenerated = buildWithGeneratedRuntime(op, inputs);
      expect(viaGenerated.url).toBe(viaExecutor.request.url);
      expect(viaGenerated.body).toBe(viaExecutor.request.body);
    });
  }

  it('drops absent optional inputs in both implementations', () => {
    const op = operation();
    const inputs = { todoId: 'todo_1' };
    const viaExecutor = prepareHttpRequest(
      op.transport as Extract<Operation['transport'], { type: 'http' }>,
      inputs,
      {},
      op.auth,
    );
    expect(viaExecutor.request.body).toBe(JSON.stringify({ origin: 'ghostapi' }));
    expect(buildWithGeneratedRuntime(op, inputs).body).toBe(viaExecutor.request.body);
  });
});
