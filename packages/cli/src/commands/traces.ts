import { boolFlag, parse, stringFlag } from '../args.js';
import { openStore } from '../context.js';
import { emitJson, heading, keyValues, note, out, style, table } from '../ui.js';

function relative(at: number): string {
  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

/**
 * Reads back the record of an execution.
 *
 * Printing a trace id and then offering no way to read it would make the id
 * decoration rather than observability.
 */
export async function tracesCommand(argv: readonly string[]): Promise<void> {
  const parsed = parse(argv, { limit: { type: 'string' } });
  const store = await openStore();
  const target = await store.requireTarget(stringFlag(parsed, 'target'));
  const wanted = parsed.positionals[0];
  const traces = await store.listTraces(target.slug, Number(stringFlag(parsed, 'limit') ?? '20'));

  if (wanted) {
    const trace = traces.find((item) => item.id === wanted || item.id.endsWith(wanted));
    if (!trace) {
      if (boolFlag(parsed, 'json')) {
        emitJson({ error: 'trace not found', id: wanted });
        process.exitCode = 1;
        return;
      }
      heading('Trace not found');
      note(`No trace matching "${wanted}" in the last ${traces.length} recorded.`);
      out();
      return;
    }
    if (boolFlag(parsed, 'json')) {
      emitJson(trace);
      return;
    }

    heading(`Trace ${trace.id}`);
    keyValues([
      ['started', new Date(trace.startedAt).toISOString()],
      ...Object.entries(trace.labels).map(([key, value]) => [key, value] as const),
    ]);
    out();
    for (const span of trace.spans) {
      const mark = span.status === 'ok' ? style.gray('│') : style.red('│');
      out(`${mark} ${style.bold(span.name.padEnd(20))} ${style.gray(`${span.durationMs}ms`)}`);
      for (const [key, value] of Object.entries(span.data)) {
        out(`${style.gray('│')}   ${style.gray(key)}: ${JSON.stringify(value)}`);
      }
    }
    out();
    return;
  }

  if (boolFlag(parsed, 'json')) {
    emitJson(
      traces.map((trace) => ({
        id: trace.id,
        startedAt: trace.startedAt,
        labels: trace.labels,
        spans: trace.spans.length,
        failed: trace.spans.some((span) => span.status === 'error'),
      })),
    );
    return;
  }

  if (traces.length === 0) {
    heading('No traces yet');
    note('Every `ghostapi run` and `ghostapi ask` records one.');
    out();
    return;
  }

  heading(`Traces for ${target.name}`);
  out();
  table(
    [
      { header: 'trace' },
      { header: 'operation' },
      { header: 'when' },
      { header: 'spans', align: 'right' },
      { header: '' },
    ],
    traces.map((trace) => [
      style.gray(trace.id),
      style.bold(trace.labels.operation ?? '—'),
      relative(trace.startedAt),
      String(trace.spans.length),
      trace.spans.some((span) => span.status === 'error') ? style.red('failed') : '',
    ]),
  );
  out();
  note('Read one with:  ghostapi traces <id>');
  out();
}
