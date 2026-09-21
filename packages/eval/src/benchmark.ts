import { ErrorCodes, GhostError, type BrowserTransport, type Operation } from '@ghostapi/core';
import { executeOperation, type AuthMaterial, type BrowserRunner } from '@ghostapi/executor';

/** A figure GhostAPI either measured or explicitly could not measure. */
export type Measured<T> =
  | { readonly measured: true; readonly value: T }
  | { readonly measured: false; readonly reason: string };

export function measured<T>(value: T): Measured<T> {
  return { measured: true, value };
}
export function unavailable<T>(reason: string): Measured<T> {
  return { measured: false, reason };
}

export interface PathResult {
  readonly label: string;
  readonly ok: boolean;
  readonly durationMs: Measured<number>;
  readonly interactions: Measured<number>;
  readonly networkRequests: Measured<number>;
  readonly modelCalls: Measured<number>;
  readonly tokens: Measured<number>;
  readonly error?: string;
}

export interface BenchmarkResult {
  readonly operation: string;
  readonly runs: number;
  readonly browser: PathResult;
  readonly api: PathResult;
  readonly speedup?: number;
  readonly notes: string[];
}

export interface BenchmarkOptions {
  readonly operation: Operation;
  readonly inputs: Record<string, unknown>;
  readonly auth: AuthMaterial;
  readonly browser?: BrowserRunner;
  /** Requests observed during the browser run, supplied by the caller's capture sink. */
  readonly browserRequestCounter?: () => number;
  readonly runs?: number;
  /** Tokens spent routing the intent, when a decision engine was used. */
  readonly routingTokens?: number;
}

function browserTransportOf(operation: Operation): BrowserTransport | undefined {
  return [operation.transport, ...operation.fallbacks].find(
    (transport): transport is BrowserTransport => transport.type === 'browser',
  );
}

async function timeIt(
  fn: () => Promise<void>,
): Promise<{ ok: boolean; ms: number; error?: string }> {
  const startedAt = Date.now();
  try {
    await fn();
    return { ok: true, ms: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const HONESTY_NOTE =
  'The browser figure is a scripted replay of the recorded UI steps with no model in the loop. ' +
  'A real browser agent adds model latency and tokens on top, so this comparison understates the gap rather than inflating it.';

/**
 * Measures the same operation both ways.
 *
 * Every number here is timed in this process. Anything GhostAPI cannot measure
 * — agent tokens, model calls in a path where no model ran — is reported as
 * unavailable rather than estimated.
 */
export async function benchmarkOperation(options: BenchmarkOptions): Promise<BenchmarkResult> {
  const runs = Math.max(1, options.runs ?? 1);
  const browserTransport = browserTransportOf(options.operation);
  const notes = [HONESTY_NOTE];

  let browser: PathResult;
  if (!browserTransport || !options.browser) {
    browser = {
      label: 'browser (recorded UI replay)',
      ok: false,
      durationMs: unavailable('no browser transport was recorded for this operation'),
      interactions: unavailable('no browser transport was recorded for this operation'),
      networkRequests: unavailable('no browser transport was recorded for this operation'),
      modelCalls: measured(0),
      tokens: unavailable('no model ran on this path'),
      error: 'browser path unavailable',
    };
  } else {
    const before = options.browserRequestCounter?.() ?? 0;
    const durations: number[] = [];
    let ok = true;
    let error: string | undefined;
    for (let index = 0; index < runs; index += 1) {
      const runner = options.browser as BrowserRunner;
      const outcome = await timeIt(async () => {
        await runner.run(browserTransport, options.inputs);
      });
      durations.push(outcome.ms);
      if (!outcome.ok) {
        ok = false;
        error = outcome.error;
        break;
      }
    }
    const after = options.browserRequestCounter?.() ?? 0;
    const interactive = browserTransport.steps.filter((step) =>
      ['click', 'fill', 'press', 'navigate'].includes(step.action),
    ).length;
    browser = {
      label: 'browser (recorded UI replay)',
      ok,
      durationMs: measured(Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)),
      interactions: measured(interactive),
      networkRequests: options.browserRequestCounter
        ? measured(after - before)
        : unavailable('no capture sink was attached to this run'),
      modelCalls: measured(0),
      tokens: unavailable('no model ran on this path'),
      ...(error ? { error } : {}),
    };
  }

  const apiDurations: number[] = [];
  let apiOk = true;
  let apiError: string | undefined;
  for (let index = 0; index < runs; index += 1) {
    const outcome = await timeIt(async () => {
      await executeOperation({
        operation: options.operation,
        inputs: options.inputs,
        auth: options.auth,
        confirmed: true,
        forceTransport: options.operation.transport.type === 'graphql' ? 'graphql' : 'http',
      });
    });
    apiDurations.push(outcome.ms);
    if (!outcome.ok) {
      apiOk = false;
      apiError = outcome.error;
      break;
    }
  }

  const api: PathResult = {
    label: 'ghostapi (direct API)',
    ok: apiOk,
    durationMs: measured(Math.round(apiDurations.reduce((a, b) => a + b, 0) / apiDurations.length)),
    interactions: measured(0),
    networkRequests: measured(1),
    modelCalls: measured(options.routingTokens === undefined ? 0 : 1),
    tokens: options.routingTokens === undefined ? measured(0) : measured(options.routingTokens),
    ...(apiError ? { error: apiError } : {}),
  };

  if (options.routingTokens === undefined) {
    notes.push('Zero model calls on the GhostAPI path: `run` executes a typed operation directly.');
  }

  const speedup =
    browser.durationMs.measured &&
    api.durationMs.measured &&
    api.durationMs.value > 0 &&
    browser.ok &&
    apiOk
      ? browser.durationMs.value / api.durationMs.value
      : undefined;

  return { operation: options.operation.name, runs, browser, api, speedup, notes };
}

export function requireBenchmarkable(operation: Operation): void {
  if (operation.transport.type === 'browser' && operation.fallbacks.length === 0) {
    throw new GhostError({
      code: ErrorCodes.TransportUnsupported,
      title: 'Nothing to compare',
      detail: `${operation.name} only has a browser transport, so there is no API path to benchmark against.`,
      remedy:
        'Observe the application again so GhostAPI can derive an API transport for this action.',
    });
  }
}
