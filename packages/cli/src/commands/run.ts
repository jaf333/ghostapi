import { updateOperation, type Operation } from '@ghostapi/core';
import { executeOperation, type ExecutionResult } from '@ghostapi/executor';
import { routeIntent, selectEngine, type EngineName } from '@ghostapi/decision';
import type { GhostStore } from '@ghostapi/store';
import { boolFlag, parse, parseJsonArgument, requirePositional, stringFlag } from '../args.js';
import { authFor, needsBrowser, openStore, startBrowserRunner } from '../context.js';
import { emitJson, heading, keyValues, note, out, style, symbols } from '../ui.js';

async function markVerified(
  store: GhostStore,
  slug: string,
  operation: Operation,
  result: ExecutionResult,
): Promise<void> {
  if (!result.ok || result.transport === 'browser') return;
  if (operation.verified && operation.confidence >= 0.97) return;
  await store.saveOperation(
    slug,
    updateOperation(operation, { verified: true, confidence: 0.97, lastVerifiedAt: Date.now() }),
  );
}

function printResult(result: ExecutionResult, extra: (readonly [string, string])[] = []): void {
  out();
  keyValues([
    ['operation', style.bold(result.operation)],
    ['transport', result.transport],
    ['request', result.requestSummary],
    ['auth', result.authDescription],
    ['status', String(result.status ?? '—')],
    ['latency', `${result.latencyMs} ms`],
    ['trace', style.gray(result.trace.id)],
    ...extra,
  ]);
  out();
  const rendered = JSON.stringify(result.data, null, 2) ?? 'null';
  out(
    rendered.length > 2000 ? `${rendered.slice(0, 2000)}\n${style.gray('… truncated')}` : rendered,
  );
  out();
}

export async function runCommand(argv: readonly string[]): Promise<void> {
  const parsed = parse(argv, {
    transport: { type: 'string' },
    headless: { type: 'boolean', default: true },
  });
  const name = requirePositional(parsed, 0, 'operation name');
  const inputs = parseJsonArgument(parsed.positionals[1]);

  const store = await openStore();
  const target = await store.requireTarget(stringFlag(parsed, 'target'));
  const operation = await store.requireOperation(target.slug, name);
  const auth = await authFor(store, target);

  const forced = stringFlag(parsed, 'transport');
  const browser =
    needsBrowser(operation) || forced === 'browser'
      ? await startBrowserRunner(store, target, { headless: boolFlag(parsed, 'headless') })
      : undefined;

  try {
    const result = await executeOperation({
      operation,
      inputs,
      auth,
      confirmed: boolFlag(parsed, 'yes'),
      browser,
      ...(forced ? { forceTransport: forced as 'http' | 'browser' | 'graphql' | 'webmcp' } : {}),
    });
    await store.saveTrace(target.slug, result.trace);
    await markVerified(store, target.slug, operation, result);

    if (boolFlag(parsed, 'json')) {
      emitJson({
        ok: result.ok,
        operation: result.operation,
        transport: result.transport,
        status: result.status,
        latencyMs: result.latencyMs,
        traceId: result.trace.id,
        data: result.data,
      });
      return;
    }
    printResult(result);
  } finally {
    await browser?.close();
  }
}

export async function askCommand(argv: readonly string[]): Promise<void> {
  const parsed = parse(argv, {
    engine: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'min-confidence': { type: 'string' },
    headless: { type: 'boolean', default: true },
  });
  const intent = requirePositional(parsed, 0, 'intent');

  const store = await openStore();
  const target = await store.requireTarget(stringFlag(parsed, 'target'));
  const operations = await store.listOperations(target.slug);
  const config = await store.config();

  const engineName = (stringFlag(parsed, 'engine') ??
    config.decisionEngine ??
    'auto') as EngineName;
  const selection = await selectEngine(engineName);

  const route = await routeIntent({
    intent,
    operations,
    engine: selection.engine,
    minConfidence: Number(stringFlag(parsed, 'min-confidence') ?? '0'),
  });

  const json = boolFlag(parsed, 'json');
  if (!json) {
    heading('Intent');
    out(`  ${intent}`);
    out();
    heading('Decision');
    keyValues([
      ['operation', style.bold(route.operation.name)],
      ['confidence', `${(route.decision.confidence * 100).toFixed(1)}%`],
      ['engine', route.decision.engine],
      ...(route.decision.rationale
        ? ([['why', style.gray(route.decision.rationale)]] as const)
        : []),
    ]);
    if (route.binding.bound.length > 0) {
      out();
      heading('Arguments');
      for (const argument of route.binding.bound) {
        out(
          `  ${style.bold(argument.field)} = ${JSON.stringify(argument.value)}  ${style.gray(
            `(${argument.note})`,
          )}`,
        );
      }
    }
    for (const skippedEngine of selection.skipped) {
      note(`  ${style.gray(`${skippedEngine.name} not used: ${skippedEngine.reason}`)}`);
    }
  }

  if (route.binding.missing.length > 0) {
    if (json) {
      emitJson({
        intent,
        decision: route.decision,
        operation: route.operation.name,
        inputs: route.binding.inputs,
        missing: route.binding.missing,
        executed: false,
      });
      process.exitCode = 1;
      return;
    }
    out();
    note(
      `Cannot run yet: missing ${route.binding.missing.join(', ')}. Provide them explicitly, for example:`,
    );
    note(
      `  ghostapi run ${route.operation.name} '${JSON.stringify(
        Object.fromEntries(route.binding.missing.map((field) => [field, '…'])),
      )}'`,
    );
    out();
    return;
  }

  if (boolFlag(parsed, 'dry-run')) {
    if (json) {
      emitJson({
        intent,
        decision: route.decision,
        operation: route.operation.name,
        inputs: route.binding.inputs,
        executed: false,
      });
      return;
    }
    out();
    note('Dry run: not executed.');
    out();
    return;
  }

  const auth = await authFor(store, target);
  const browser = needsBrowser(route.operation)
    ? await startBrowserRunner(store, target, { headless: boolFlag(parsed, 'headless') })
    : undefined;

  try {
    const result = await executeOperation({
      operation: route.operation,
      inputs: route.binding.inputs,
      auth,
      confirmed: boolFlag(parsed, 'yes'),
      browser,
    });
    await store.saveTrace(target.slug, result.trace);
    await markVerified(store, target.slug, route.operation, result);

    if (json) {
      emitJson({
        intent,
        decision: route.decision,
        operation: route.operation.name,
        inputs: route.binding.inputs,
        executed: true,
        status: result.status,
        latencyMs: result.latencyMs,
        traceId: result.trace.id,
        data: result.data,
      });
      return;
    }
    out();
    heading('Execution');
    printResult(result, [
      ['decision', `${route.decision.engine} ${symbols.arrow} ${route.operation.name}`],
    ]);
  } finally {
    await browser?.close();
  }
}
