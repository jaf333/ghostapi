import { inferOperations, type DiscoveryResult } from '@ghostapi/discovery';
import type { GhostStore } from '@ghostapi/store';
import { boolFlag, parse, stringFlag } from '../args.js';
import { openStore } from '../context.js';
import { emitJson, heading, note, out, step, style, table } from '../ui.js';

/** Re-derives operations from everything stored for a target. */
export async function runDiscovery(store: GhostStore, slug: string): Promise<DiscoveryResult> {
  const target = await store.requireTarget(slug);
  const observations = await store.readAllObservations(slug);
  const existing = await store.listOperations(slug);
  const result = inferOperations({ target, observations, existing });
  for (const operation of result.operations) {
    await store.saveOperation(slug, operation);
  }
  return result;
}

export async function observeCommand(argv: readonly string[]): Promise<void> {
  const parsed = parse(argv, {});
  const store = await openStore();
  const target = await store.requireTarget(stringFlag(parsed, 'target'));
  const result = await runDiscovery(store, target.slug);

  if (boolFlag(parsed, 'json')) {
    emitJson({
      target: target.slug,
      candidateGroups: result.candidateGroups,
      ambiguities: result.ambiguities,
      skipped: result.skipped,
      operations: result.operations.map((operation) => ({
        name: operation.name,
        verb: operation.verb,
        confidence: operation.confidence,
        observations: operation.observationCount,
      })),
    });
    return;
  }

  heading(`Re-derived operations for ${target.name}`);
  step(`${result.candidateGroups} candidate endpoint group(s)`);
  step(`${result.operations.length} operation(s)`);
  if (result.ambiguities > 0) {
    note(`${result.ambiguities} request(s) had more than one plausible UI cause.`);
  }
  out();
  table(
    [{ header: 'operation' }, { header: 'verb' }, { header: 'confidence', align: 'right' }],
    result.operations.map((operation) => [
      style.bold(operation.name),
      operation.verb,
      `${Math.round(operation.confidence * 100)}%`,
    ]),
  );
  if (result.skipped.length > 0) {
    out();
    note('Skipped:');
    for (const entry of result.skipped) note(`  ${entry.key} — ${entry.reason}`);
  }
  out();
}
