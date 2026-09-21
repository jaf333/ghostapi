import { parseArgs, type ParseArgsConfig } from 'node:util';
import { ErrorCodes, GhostError } from '@ghostapi/core';

export type FlagSpec = NonNullable<ParseArgsConfig['options']>;

export interface Parsed {
  readonly values: Record<string, string | boolean | string[] | undefined>;
  readonly positionals: string[];
}

const GLOBAL_FLAGS: FlagSpec = {
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
  target: { type: 'string' },
  yes: { type: 'boolean', short: 'y', default: false },
};

export function parse(argv: readonly string[], flags: FlagSpec = {}): Parsed {
  try {
    const result = parseArgs({
      args: [...argv],
      options: { ...GLOBAL_FLAGS, ...flags },
      allowPositionals: true,
      strict: true,
    });
    return { values: result.values as Parsed['values'], positionals: result.positionals };
  } catch (error) {
    throw new GhostError(
      {
        code: ErrorCodes.InvalidInput,
        title: 'Could not read the command line',
        detail: error instanceof Error ? error.message : String(error),
        remedy: 'Run `ghostapi help` to see the available commands and flags.',
      },
      { cause: error },
    );
  }
}

export function stringFlag(parsed: Parsed, name: string): string | undefined {
  const value = parsed.values[name];
  return typeof value === 'string' ? value : undefined;
}

export function boolFlag(parsed: Parsed, name: string): boolean {
  return parsed.values[name] === true;
}

export function requirePositional(parsed: Parsed, index: number, what: string): string {
  const value = parsed.positionals[index];
  if (value === undefined || value.length === 0) {
    throw new GhostError({
      code: ErrorCodes.InvalidInput,
      title: `Missing ${what}`,
      detail: `This command needs a ${what}.`,
      remedy: 'Run `ghostapi help` to see the expected arguments.',
    });
  }
  return value;
}

export function parseJsonArgument(
  raw: string | undefined,
  what = 'input',
): Record<string, unknown> {
  if (raw === undefined || raw.trim().length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new GhostError(
      {
        code: ErrorCodes.InvalidInput,
        title: `Invalid ${what} JSON`,
        detail: error instanceof Error ? error.message : String(error),
        remedy: `Quote the JSON so the shell keeps it intact:\n\n  ghostapi run <operation> '{"field":"value"}'`,
      },
      { cause: error },
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new GhostError({
      code: ErrorCodes.InvalidInput,
      title: `Invalid ${what}`,
      detail: 'Operation inputs must be a JSON object.',
      remedy: `For example:\n\n  ghostapi run createTodo '{"title":"Buy milk"}'`,
    });
  }
  return parsed as Record<string, unknown>;
}
