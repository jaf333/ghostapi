import { describe, expect, it } from 'vitest';
import { operationSchema, type Operation } from '@ghostapi/core';
import { evalSuiteSchema, generateSuite } from './case-file.js';
import { runEvals } from './run-eval.js';
import { measured, unavailable } from './benchmark.js';

function operation(overrides: Record<string, unknown> = {}): Operation {
  return operationSchema.parse({
    id: 'op_x',
    name: 'listTodos',
    description: 'List todo records.',
    entity: 'todo',
    verb: 'list',
    inputs: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['active', 'all'], examples: ['active'] } },
      required: ['status'],
      additionalProperties: false,
    },
    transport: {
      type: 'http',
      method: 'GET',
      urlTemplate: 'https://app.example.com/api/todos',
      pathParams: [],
      query: { status: { kind: 'input', field: 'status' } },
      headers: {},
      bodyKind: 'none',
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

describe('generateSuite', () => {
  it('generates a runnable smoke case for a read-only operation', () => {
    const suite = generateSuite(operation());
    expect(suite.cases[0]?.skip).toBeUndefined();
    expect(suite.cases[0]?.input).toEqual({ status: 'active' });
  });

  it('skips a generated case that would write data', () => {
    const suite = generateSuite(operation({ name: 'createTodo', verb: 'create' }));
    expect(suite.cases[0]?.skip).toMatch(/writes data/);
  });

  it('never opts a destructive operation in by default', () => {
    const suite = generateSuite(
      operation({ name: 'deleteTodo', verb: 'delete', destructive: true }),
    );
    expect(suite.allowDestructive).toBe(false);
    expect(suite.cases[0]?.skip).toMatch(/destructive/);
  });

  it('produces a suite that parses against its own schema', () => {
    expect(() => evalSuiteSchema.parse(generateSuite(operation()))).not.toThrow();
  });
});

describe('runEvals', () => {
  const okFetch = (async () =>
    new Response(JSON.stringify({ todos: [{ id: 'todo_1', title: 'Buy milk' }], total: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

  it('passes a case whose expectations hold', async () => {
    const report = await runEvals({
      suites: [
        evalSuiteSchema.parse({
          operation: 'listTodos',
          cases: [
            {
              name: 'lists todos',
              input: { status: 'active' },
              expect: { status: 'success', present: ['todos'], properties: { total: 1 } },
            },
          ],
        }),
      ],
      operations: [operation()],
      auth: {},
      fetchImpl: okFetch,
    });
    expect(report.passed).toBe(1);
    expect(report.reliability).toBe(1);
  });

  it('fails a case whose expectation does not hold, and says why', async () => {
    const report = await runEvals({
      suites: [
        evalSuiteSchema.parse({
          operation: 'listTodos',
          cases: [
            {
              name: 'wrong total',
              input: { status: 'active' },
              expect: { properties: { total: 99 } },
            },
          ],
        }),
      ],
      operations: [operation()],
      auth: {},
      fetchImpl: okFetch,
    });
    expect(report.failed).toBe(1);
    expect(report.results[0]?.reason).toMatch(/expected total to equal 99/);
  });

  it('passes an error case when the operation is expected to fail', async () => {
    const report = await runEvals({
      suites: [
        evalSuiteSchema.parse({
          operation: 'listTodos',
          cases: [{ name: 'missing status', input: {}, expect: { status: 'error' } }],
        }),
      ],
      operations: [operation()],
      auth: {},
      fetchImpl: okFetch,
    });
    expect(report.passed).toBe(1);
  });

  it('reports reliability over the cases that actually ran, not over the skipped ones', async () => {
    const report = await runEvals({
      suites: [
        evalSuiteSchema.parse({
          operation: 'listTodos',
          cases: [
            { name: 'runs', input: { status: 'active' }, expect: { status: 'success' } },
            { name: 'skipped', input: { status: 'active' }, skip: 'not now' },
          ],
        }),
      ],
      operations: [operation()],
      auth: {},
      fetchImpl: okFetch,
    });
    expect(report.skipped).toBe(1);
    expect(report.passed).toBe(1);
    expect(report.reliability).toBe(1);
  });

  it('leaves reliability unavailable when nothing ran', async () => {
    const report = await runEvals({
      suites: [
        evalSuiteSchema.parse({
          operation: 'listTodos',
          cases: [{ name: 'skipped', input: {}, skip: 'not now' }],
        }),
      ],
      operations: [operation()],
      auth: {},
    });
    expect(report.reliability).toBeUndefined();
  });

  it('will not run a destructive suite that did not opt in', async () => {
    const report = await runEvals({
      suites: [
        evalSuiteSchema.parse({
          operation: 'deleteTodo',
          cases: [{ name: 'deletes', input: { status: 'active' } }],
        }),
      ],
      operations: [operation({ name: 'deleteTodo', verb: 'delete', destructive: true })],
      auth: {},
      fetchImpl: okFetch,
    });
    expect(report.skipped).toBe(1);
    expect(report.results[0]?.reason).toMatch(/destructive/);
  });
});

describe('measured figures', () => {
  it('distinguishes a measurement from an absence of one', () => {
    expect(measured(42)).toEqual({ measured: true, value: 42 });
    const missing = unavailable<number>('no model ran');
    expect(missing.measured).toBe(false);
    expect(missing.measured === false && missing.reason).toBe('no model ran');
  });
});

describe('benchmark reporting', () => {
  it('reports the median, not the mean, so one outlier cannot decide the headline', async () => {
    const { benchmarkOperation } = await import('./benchmark.js');
    let call = 0;
    // 1 warm-up + 5 timed. One timed call is deliberately slow.
    const slowOnce = (async () => {
      call += 1;
      if (call === 3) await new Promise((resolve) => setTimeout(resolve, 120));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const original = globalThis.fetch;
    globalThis.fetch = slowOnce;
    try {
      const result = await benchmarkOperation({
        operation: operation(),
        inputs: { status: 'active' },
        auth: {},
        runs: 5,
      });
      expect(result.api.durationMs.measured).toBe(true);
      expect(result.api.spread.measured).toBe(true);
      if (result.api.spread.measured) {
        expect(result.api.spread.value.samples).toBe(5);
        // The slow call is visible in the spread but does not move the median.
        expect(result.api.spread.value.max).toBeGreaterThanOrEqual(100);
      }
      if (result.api.durationMs.measured) {
        expect(result.api.durationMs.value).toBeLessThan(100);
      }
    } finally {
      globalThis.fetch = original;
    }
  });

  it('discloses its method alongside the numbers', async () => {
    const { benchmarkOperation } = await import('./benchmark.js');
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    try {
      const result = await benchmarkOperation({
        operation: operation(),
        inputs: { status: 'active' },
        auth: {},
        runs: 2,
      });
      expect(result.notes.some((note) => /median/.test(note))).toBe(true);
      expect(result.notes.some((note) => /understates/.test(note))).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });
});
