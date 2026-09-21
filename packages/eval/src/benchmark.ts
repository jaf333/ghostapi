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

export interface DurationSpread {
  readonly min: number;
  readonly max: number;
  readonly samples: number;
}

export interface PathResult {
  readonly label: string;
  readonly ok: boolean;
  /** Median of the timed runs. A mean would let one slow run dominate. */
  readonly durationMs: Measured<number>;
  readonly spread: Measured<DurationSpread>;
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

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 0
    ? Math.round(((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2)
    : (sorted[middle] as number);
}

function spreadOf(values: readonly number[]): DurationSpread {
  return { min: Math.min(...values), max: Math.max(...values), samples: values.length };
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

const METHOD_NOTE =
  'Each path runs once untimed to warm up, then the reported figure is the median of the timed runs. ' +
  'A single cold run is dominated by process warm-up, and a mean lets one outlier decide the headline.';

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
  const notes = [HONESTY_NOTE, METHOD_NOTE];

  let browser: PathResult;
  if (!browserTransport || !options.browser) {
    browser = {
      label: 'browser (recorded UI replay)',
      ok: false,
      durationMs: unavailable('no browser transport was recorded for this operation'),
      spread: unavailable('no browser transport was recorded for this operation'),
      interactions: unavailable('no browser transport was recorded for this operation'),
      networkRequests: unavailable('no browser transport was recorded for this operation'),
      modelCalls: measured(0),
      tokens: unavailable('no model ran on this path'),
      error: 'browser path unavailable',
    };
  } else {
    const runner = options.browser as BrowserRunner;
    // Untimed warm-up: the first run pays for the page load and the profile.
    const warmUp = await timeIt(async () => {
      await runner.run(browserTransport, options.inputs);
    });
    const before = options.browserRequestCounter?.() ?? 0;
    const durations: number[] = [];
    let ok = warmUp.ok;
    let error: string | undefined = warmUp.error;
    for (let index = 0; ok && index < runs; index += 1) {
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
    if (durations.length === 0) durations.push(warmUp.ms);
    const after = options.browserRequestCounter?.() ?? 0;
    const interactive = browserTransport.steps.filter((step) =>
      ['click', 'fill', 'press', 'navigate'].includes(step.action),
    ).length;
    browser = {
      label: 'browser (recorded UI replay)',
      ok,
      durationMs: measured(median(durations)),
      spread: measured(spreadOf(durations)),
      interactions: measured(interactive),
      networkRequests: options.browserRequestCounter
        ? measured(after - before)
        : unavailable('no capture sink was attached to this run'),
      modelCalls: measured(0),
      tokens: unavailable('no model ran on this path'),
      ...(error ? { error } : {}),
    };
  }

  const runApi = async (): Promise<{ ok: boolean; ms: number; error?: string }> =>
    timeIt(async () => {
      await executeOperation({
        operation: options.operation,
        inputs: options.inputs,
        auth: options.auth,
        confirmed: true,
        forceTransport: options.operation.transport.type === 'graphql' ? 'graphql' : 'http',
      });
    });

  // Untimed warm-up: the first fetch in a process pays for DNS, the agent and
  // the JIT, none of which the operation itself costs.
  const apiWarmUp = await runApi();
  const apiDurations: number[] = [];
  let apiOk = apiWarmUp.ok;
  let apiError: string | undefined = apiWarmUp.error;
  for (let index = 0; apiOk && index < runs; index += 1) {
    const outcome = await runApi();
    apiDurations.push(outcome.ms);
    if (!outcome.ok) {
      apiOk = false;
      apiError = outcome.error;
      break;
    }
  }
  if (apiDurations.length === 0) apiDurations.push(apiWarmUp.ms);

  const api: PathResult = {
    label: 'ghostapi (direct API)',
    ok: apiOk,
    durationMs: measured(median(apiDurations)),
    spread: measured(spreadOf(apiDurations)),
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
