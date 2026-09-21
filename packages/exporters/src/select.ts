import { confidenceBand, type Operation } from '@ghostapi/core';

export interface SelectionOptions {
  /** Include operations below the "likely" confidence band. */
  readonly includeWeak?: boolean;
  /** Include destructive operations. */
  readonly includeDestructive?: boolean;
  /** Explicit allow-list by name; wins over every other filter. */
  readonly only?: readonly string[];
}

export interface SelectionResult {
  readonly selected: Operation[];
  readonly excluded: { readonly name: string; readonly reason: string }[];
}

/**
 * Chooses which operations to publish.
 *
 * Exporting everything discovered would hand an agent a catalogue padded with
 * guesses and near-duplicates. The default is deliberately conservative: only
 * operations GhostAPI can stand behind, with anything destructive opted in.
 */
export function selectForExport(
  operations: readonly Operation[],
  options: SelectionOptions = {},
): SelectionResult {
  if (options.only && options.only.length > 0) {
    const wanted = new Set(options.only);
    return {
      selected: operations.filter((operation) => wanted.has(operation.name)),
      excluded: operations
        .filter((operation) => !wanted.has(operation.name))
        .map((operation) => ({ name: operation.name, reason: 'not in --only' })),
    };
  }

  const selected: Operation[] = [];
  const excluded: { name: string; reason: string }[] = [];

  for (const operation of operations) {
    const band = confidenceBand(operation);
    if (!options.includeWeak && (band === 'weak' || band === 'candidate')) {
      excluded.push({
        name: operation.name,
        reason: `confidence ${Math.round(operation.confidence * 100)}% is only a ${band} match`,
      });
      continue;
    }
    if (!options.includeDestructive && operation.destructive) {
      excluded.push({ name: operation.name, reason: 'destructive; pass --include-destructive' });
      continue;
    }
    if (operation.transport.type === 'browser' && operation.fallbacks.length === 0) {
      excluded.push({ name: operation.name, reason: 'browser-only; not replayable outside the CLI' });
      continue;
    }
    selected.push(operation);
  }

  return { selected, excluded };
}
