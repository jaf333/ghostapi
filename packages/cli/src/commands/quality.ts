import { join } from 'node:path';
import { generateSuite, readSuites, runEvals, writeSuite, benchmarkOperation, requireBenchmarkable, type Measured } from '@ghostapi/eval';
import { boolFlag, parse, parseJsonArgument, requirePositional, stringFlag } from '../args.js';
import { authFor, openStore, startBrowserRunner } from '../context.js';
import { emitJson, heading, keyValues, note, out, style, symbols, table } from '../ui.js';

function evalsDir(root: string, slug: string): string {
  return join(root, 'targets', slug, 'evals');
}

export async function evalCommand(argv: readonly string[]): Promise<void> {
  const parsed = parse(argv, {
    generate: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
  });
  const store = await openStore();
  const target = await store.requireTarget(stringFlag(parsed, 'target'));
  const operations = await store.listOperations(target.slug);
  const dir = evalsDir(store.paths.root, target.slug);

  if (boolFlag(parsed, 'generate')) {
    const written: string[] = [];
    for (const operation of operations) {
      written.push(await writeSuite(dir, generateSuite(operation)));
    }
    if (boolFlag(parsed, 'json')) {
      emitJson({ generated: written });
      return;
    }
    heading('Eval suites generated');
    keyValues([
      ['directory', dir],
      ['suites', String(written.length)],
    ]);
    out();
    note('Review each file, remove the `skip:` lines you are happy to run, then:');
    note('  ghostapi eval');
    out();
    return;
  }

  const suites = await readSuites(dir);
  if (suites.length === 0) {
    heading('No eval suites yet');
    note('Run `ghostapi eval --generate` to create a starting set from what was observed.');
    out();
    return;
  }

  const auth = await authFor(store, target);
  const report = await runEvals({
    suites,
    operations,
    auth,
    force: boolFlag(parsed, 'force'),
  });

  if (boolFlag(parsed, 'json')) {
    emitJson(report);
    return;
  }

  heading(`Evals for ${target.name}`);
  out();
  for (const result of report.results) {
    const mark =
      result.status === 'passed' ? symbols.ok : result.status === 'failed' ? symbols.fail : symbols.skip;
    const timing = result.latencyMs !== undefined ? style.gray(` ${result.latencyMs}ms`) : '';
    out(`  ${mark} ${result.name}${timing}`);
    if (result.reason) out(`      ${style.gray(result.reason)}`);
  }
  out();
  keyValues([
    ['operations', String(report.operations)],
    ['cases', String(report.total)],
    ['passed', String(report.passed)],
    ['failed', report.failed > 0 ? style.red(String(report.failed)) : '0'],
    ['skipped', String(report.skipped)],
    [
      'reliability',
      report.reliability === undefined
        ? style.gray('unavailable — no cases ran')
        : `${(report.reliability * 100).toFixed(1)}%`,
    ],
  ]);
  out();
  if (report.failed > 0) process.exitCode = 1;
}

function renderMeasured(value: Measured<number>, suffix = ''): string {
  return value.measured ? `${value.value}${suffix}` : style.gray(`unavailable — ${value.reason}`);
}

export async function benchmarkCommand(argv: readonly string[]): Promise<void> {
  const parsed = parse(argv, {
    runs: { type: 'string' },
    headless: { type: 'boolean', default: true },
  });
  const name = requirePositional(parsed, 0, 'operation name');
  const inputs = parseJsonArgument(parsed.positionals[1]);

  const store = await openStore();
  const target = await store.requireTarget(stringFlag(parsed, 'target'));
  const operation = await store.requireOperation(target.slug, name);
  requireBenchmarkable(operation);

  const auth = await authFor(store, target);
  const browser = await startBrowserRunner(store, target, {
    headless: boolFlag(parsed, 'headless'),
  });

  try {
    const result = await benchmarkOperation({
      operation,
      inputs,
      auth,
      browser,
      browserRequestCounter: () => browser.observedRequests(),
      runs: Number(stringFlag(parsed, 'runs') ?? '1'),
    });

    if (boolFlag(parsed, 'json')) {
      emitJson(result);
      return;
    }

    heading(`Benchmark: ${style.bold(operation.name)}`);
    out(style.gray(`${result.runs} run(s) per path`));
    out();
    table(
      [{ header: 'path' }, { header: 'time', align: 'right' }, { header: 'interactions', align: 'right' }, { header: 'requests', align: 'right' }, { header: 'model calls', align: 'right' }, { header: 'tokens' }],
      [result.browser, result.api].map((path) => [
        path.ok ? path.label : `${path.label} ${style.red('(failed)')}`,
        path.durationMs.measured ? `${path.durationMs.value} ms` : style.gray('unavailable'),
        renderMeasured(path.interactions),
        renderMeasured(path.networkRequests),
        renderMeasured(path.modelCalls),
        renderMeasured(path.tokens),
      ]),
    );
    for (const path of [result.browser, result.api]) {
      if (path.error) {
        out();
        out(`${style.red(path.label)}: ${path.error.split('\n')[0]}`);
      }
    }
    out();
    if (result.speedup !== undefined) {
      out(`${style.bold(`${result.speedup.toFixed(1)}×`)} faster through the discovered API.`);
    } else {
      note('Speed-up unavailable: one of the paths did not complete.');
    }
    out();
    for (const noteText of result.notes) note(noteText);
    out();
  } finally {
    await browser.close();
  }
}
