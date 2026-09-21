#!/usr/bin/env node
// Produces docs/benchmark-results.json from a real end-to-end run.
//
// Every number the README prints comes from here. Nothing is typed by hand.
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO, discoveredWorkspace, ghostapiJson } from './gates/lib.mjs';

const RUNS = Number(process.env.GHOSTAPI_BENCH_RUNS ?? '5');

const { target, cwd } = await discoveredWorkspace();
try {
  const operations = ghostapiJson(['operations'], { cwd });
  const createTodo = ghostapiJson(['inspect', 'createTodo'], { cwd });

  const sessions = ghostapiJson(['observe'], { cwd });

  const run = ghostapiJson(
    ['run', 'createTodo', JSON.stringify({ title: 'Measured run', projectId: 'prj_home', priority: 'high' })],
    { cwd },
  );

  const ask = ghostapiJson(['ask', 'create a todo called buy coffee'], { cwd });

  const benchmark = ghostapiJson(
    [
      'benchmark',
      'createTodo',
      JSON.stringify({ title: 'Benchmark todo', projectId: 'prj_inbox', priority: 'normal' }),
      '--runs',
      String(RUNS),
    ],
    { cwd, timeoutMs: 600_000 },
  );

  ghostapiJson(['eval', '--generate'], { cwd });
  const evals = ghostapiJson(['eval'], { cwd });

  const results = {
    generatedAt: new Date().toISOString(),
    generatedBy: 'node scripts/measure-demo.mjs',
    environment: {
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
    },
    target: 'apps/demo-target (the reference application in this repository)',
    discovery: {
      candidateGroups: sessions.candidateGroups,
      operations: operations.length,
      operationNames: operations.map((operation) => operation.name).sort(),
      createTodoConfidence: createTodo.confidence,
      createTodoObservations: createTodo.observationCount,
      createTodoInputs: Object.keys(createTodo.inputs.properties ?? {}).sort(),
    },
    run: {
      transport: run.transport,
      status: run.status,
      latencyMs: run.latencyMs,
    },
    ask: {
      engine: ask.decision.engine,
      operation: ask.operation,
      confidence: ask.decision.confidence,
      status: ask.status,
      latencyMs: ask.latencyMs,
    },
    benchmark: {
      runs: benchmark.runs,
      browserMs: benchmark.browser.durationMs.measured ? benchmark.browser.durationMs.value : null,
      browserSpreadMs: benchmark.browser.spread.measured ? benchmark.browser.spread.value : null,
      browserInteractions: benchmark.browser.interactions.measured
        ? benchmark.browser.interactions.value
        : null,
      browserRequests: benchmark.browser.networkRequests.measured
        ? benchmark.browser.networkRequests.value
        : null,
      browserTokens: benchmark.browser.tokens.measured ? benchmark.browser.tokens.value : 'unavailable',
      apiMs: benchmark.api.durationMs.measured ? benchmark.api.durationMs.value : null,
      apiSpreadMs: benchmark.api.spread.measured ? benchmark.api.spread.value : null,
      apiRequests: benchmark.api.networkRequests.measured ? benchmark.api.networkRequests.value : null,
      apiModelCalls: benchmark.api.modelCalls.measured ? benchmark.api.modelCalls.value : 'unavailable',
      apiTokens: benchmark.api.tokens.measured ? benchmark.api.tokens.value : 'unavailable',
      speedup: benchmark.speedup === undefined ? null : Number(benchmark.speedup.toFixed(1)),
      notes: benchmark.notes,
    },
    evals: {
      operations: evals.operations,
      cases: evals.total,
      passed: evals.passed,
      failed: evals.failed,
      skipped: evals.skipped,
      reliabilityPercent: evals.reliability === undefined ? null : Number((evals.reliability * 100).toFixed(1)),
    },
  };

  const file = join(REPO, 'docs', 'benchmark-results.json');
  await writeFile(file, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  process.stdout.write(`${file}\n`);

  // The published table is a projection of the measurement, never typed by hand.
  const { spawnSync } = await import('node:child_process');
  spawnSync(process.execPath, [join(REPO, 'scripts', 'render-benchmark.mjs')], { stdio: 'inherit' });
  process.stdout.write(
    `browser ${results.benchmark.browserMs}ms vs api ${results.benchmark.apiMs}ms → ${results.benchmark.speedup}x\n`,
  );
} finally {
  await target.stop();
}
