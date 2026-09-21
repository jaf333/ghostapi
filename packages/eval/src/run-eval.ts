import { isGhostError, type Operation } from '@ghostapi/core';
import { executeOperation, type AuthMaterial, type BrowserRunner } from '@ghostapi/executor';
import type { EvalCase, EvalSuite } from './case-file.js';

export interface CaseResult {
  readonly operation: string;
  readonly name: string;
  readonly status: 'passed' | 'failed' | 'skipped';
  readonly reason?: string;
  readonly latencyMs?: number;
}

export interface EvalReport {
  readonly results: CaseResult[];
  readonly operations: number;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  /** Passed as a fraction of cases that actually ran. Undefined when none ran. */
  readonly reliability?: number;
}

function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      return Number.isInteger(index) ? current[index] : undefined;
    }
    if (typeof current === 'object') return (current as Record<string, unknown>)[segment];
    return undefined;
  }, value);
}

function checkExpectation(
  expectation: EvalCase['expect'],
  outcome: { ok: boolean; data: unknown; error?: string },
): string | undefined {
  if (expectation.status === 'error') {
    if (outcome.ok) return 'expected the operation to fail, but it succeeded';
    if (expectation.errorContains && !(outcome.error ?? '').includes(expectation.errorContains)) {
      return `expected the error to mention "${expectation.errorContains}", got "${outcome.error ?? ''}"`;
    }
    return undefined;
  }
  if (!outcome.ok) return outcome.error ?? 'operation failed';

  for (const path of expectation.present) {
    if (readPath(outcome.data, path) === undefined) return `expected "${path}" in the response`;
  }
  for (const [path, expected] of Object.entries(expectation.properties)) {
    const actual = readPath(outcome.data, path);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      return `expected ${path} to equal ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
    }
  }
  return undefined;
}

export interface RunEvalOptions {
  readonly suites: readonly EvalSuite[];
  readonly operations: readonly Operation[];
  readonly auth: AuthMaterial;
  readonly browser?: BrowserRunner;
  /** Runs cases marked `skip` anyway. */
  readonly force?: boolean;
  /** Replaces the global fetch, so a suite can run against a stub. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Runs eval suites against the live target.
 *
 * Reliability is reported over the cases that actually ran, and skipped cases
 * are always shown. A suite that silently skips its mutations and then reports
 * 100% would be worse than no eval at all.
 */
export async function runEvals(options: RunEvalOptions): Promise<EvalReport> {
  const byName = new Map(options.operations.map((operation) => [operation.name, operation]));
  const results: CaseResult[] = [];

  for (const suite of options.suites) {
    const operation = byName.get(suite.operation);
    if (!operation) {
      results.push({
        operation: suite.operation,
        name: 'suite',
        status: 'skipped',
        reason: 'operation no longer exists',
      });
      continue;
    }
    for (const testCase of suite.cases) {
      if (testCase.skip && !options.force) {
        results.push({
          operation: suite.operation,
          name: testCase.name,
          status: 'skipped',
          reason: testCase.skip,
        });
        continue;
      }
      if (operation.destructive && !suite.allowDestructive && !options.force) {
        results.push({
          operation: suite.operation,
          name: testCase.name,
          status: 'skipped',
          reason: 'destructive; set allowDestructive: true in the suite to run it',
        });
        continue;
      }

      const startedAt = Date.now();
      let outcome: { ok: boolean; data: unknown; error?: string };
      try {
        const execution = await executeOperation({
          operation,
          inputs: testCase.input,
          auth: options.auth,
          confirmed: true,
          browser: options.browser,
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        });
        outcome = { ok: execution.ok, data: execution.data };
      } catch (error) {
        outcome = {
          ok: false,
          data: undefined,
          error: isGhostError(error)
            ? error.detail
            : error instanceof Error
              ? error.message
              : String(error),
        };
      }
      const failure = checkExpectation(testCase.expect, outcome);
      results.push({
        operation: suite.operation,
        name: testCase.name,
        status: failure ? 'failed' : 'passed',
        reason: failure,
        latencyMs: Date.now() - startedAt,
      });
    }
  }

  const passed = results.filter((result) => result.status === 'passed').length;
  const failed = results.filter((result) => result.status === 'failed').length;
  const skipped = results.filter((result) => result.status === 'skipped').length;
  const ran = passed + failed;

  return {
    results,
    operations: new Set(results.map((result) => result.operation)).size,
    total: results.length,
    passed,
    failed,
    skipped,
    reliability: ran > 0 ? passed / ran : undefined,
  };
}
