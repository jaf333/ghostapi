import { check, discoveredWorkspace, ghostapi, ghostapiJson, pass } from './lib.mjs';

const { target, cwd } = await discoveredWorkspace();
try {
  const generated = ghostapiJson(['eval', '--generate'], { cwd });
  check(generated.generated.length >= 5, `only ${generated.generated.length} eval suites generated`);

  const report = ghostapiJson(['eval'], { cwd });
  check(report.total >= 5, `only ${report.total} eval cases ran`);
  check(report.failed === 0, `${report.failed} eval case(s) failed: ${JSON.stringify(report.results.filter((r) => r.status === 'failed'))}`);
  check(report.passed >= 3, `only ${report.passed} eval cases passed`);
  check(report.reliability === 1, `reliability is ${report.reliability}, expected 1 with no failures`);
  check(report.skipped > 0, 'no destructive or writing cases were skipped, which is suspicious');
  check(
    report.results.filter((item) => item.status === 'skipped').every((item) => typeof item.reason === 'string'),
    'a skipped case gave no reason',
  );

  const destructiveSkips = report.results.filter(
    (item) => item.status === 'skipped' && /destructive/.test(item.reason ?? ''),
  );
  check(destructiveSkips.length > 0, 'destructive operations were not held back from the eval run');

  const benchmark = ghostapiJson(
    [
      'benchmark',
      'createTodo',
      JSON.stringify({ title: 'Benchmark todo', projectId: 'prj_inbox', priority: 'normal' }),
      '--runs',
      '3',
    ],
    { cwd, timeoutMs: 240_000 },
  );

  check(benchmark.browser.ok === true, `the browser path failed: ${benchmark.browser.error}`);
  check(benchmark.api.ok === true, `the API path failed: ${benchmark.api.error}`);
  check(benchmark.browser.durationMs.measured === true, 'the browser duration was not measured');
  check(benchmark.api.durationMs.measured === true, 'the API duration was not measured');
  check(benchmark.browser.durationMs.value > 0 && benchmark.api.durationMs.value > 0, 'a measured duration was zero');
  check(typeof benchmark.speedup === 'number' && benchmark.speedup > 1, `speedup is ${benchmark.speedup}`);

  // Honesty: anything unmeasured must say so rather than carry a number.
  check(benchmark.browser.tokens.measured === false, 'the browser path reports a token count it cannot measure');
  check(
    typeof benchmark.browser.tokens.reason === 'string' && benchmark.browser.tokens.reason.length > 0,
    'an unavailable figure gives no reason',
  );
  check(benchmark.api.modelCalls.measured === true && benchmark.api.modelCalls.value === 0, 'the API path misreports model calls');
  check(
    benchmark.notes.some((note) => /understates/.test(note)),
    'the benchmark does not disclose that the browser path runs without a model',
  );

  check(benchmark.browser.spread.measured === true, 'the browser path reports no spread');
  check(benchmark.api.spread.measured === true, 'the API path reports no spread');
  check(
    benchmark.api.spread.value.samples === benchmark.runs,
    `the API path timed ${benchmark.api.spread.value.samples} runs but reported ${benchmark.runs}`,
  );
  check(
    benchmark.api.spread.value.min <= benchmark.api.durationMs.value &&
      benchmark.api.durationMs.value <= benchmark.api.spread.value.max,
    'the reported median lies outside the measured range',
  );
  check(
    benchmark.notes.some((note) => /median/.test(note)),
    'the benchmark does not disclose that it reports a median after a warm-up run',
  );

  // The measured ratio must be consistent with the measured durations.
  const expected = benchmark.browser.durationMs.value / benchmark.api.durationMs.value;
  check(
    Math.abs(expected - benchmark.speedup) < 0.001,
    `the reported speedup ${benchmark.speedup} does not match the measured durations`,
  );

  const plain = ghostapi(['benchmark', 'createTodo', JSON.stringify({ title: 'x', projectId: 'prj_inbox', priority: 'low' })], { cwd, timeoutMs: 240_000 });
  check(/unavailable/.test(plain.stdout), 'the human-readable benchmark hides what it could not measure');

  process.stdout.write(
    `eval ${report.passed}/${report.passed + report.failed} passed; benchmark ${benchmark.speedup.toFixed(1)}x ` +
      `(browser ${benchmark.browser.durationMs.value}ms vs api ${benchmark.api.durationMs.value}ms)\n`,
  );
  pass('GATE_G11_EVAL_OK');
} finally {
  await target.stop();
}
