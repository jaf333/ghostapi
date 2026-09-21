#!/usr/bin/env node
import { isGhostError } from '@ghostapi/core';
import { parse } from './args.js';
import { openStore } from './context.js';
import { printHelp } from './help.js';
import { emitJson, heading, keyValues, note, out, renderError } from './ui.js';
import { openCommand } from './commands/open.js';
import { observeCommand } from './commands/observe.js';
import { inspectCommand, operationsCommand, targetsCommand } from './commands/operations.js';
import { askCommand, runCommand } from './commands/run.js';
import { exportCommand, importCommand } from './commands/export.js';
import { benchmarkCommand, evalCommand } from './commands/quality.js';
import { doctorCommand } from './commands/doctor.js';
import { mcpCommand } from './commands/mcp.js';
import { tracesCommand } from './commands/traces.js';

async function initCommand(argv: readonly string[]): Promise<void> {
  const parsed = parse(argv, {});
  const store = await openStore();
  const config = await store.config();
  if (parsed.values.json === true) {
    emitJson({ root: store.paths.root, config });
    return;
  }
  heading('Workspace ready');
  keyValues([
    ['directory', store.paths.root],
    ['browser channel', config.browserChannel],
    ['decision engine', config.decisionEngine],
  ]);
  out();
  note('Add .ghostapi/ to .gitignore — it holds observed traffic and your browser profile.');
  note('Next:  ghostapi open <url>');
  out();
}

const HANDLERS: Record<string, (argv: readonly string[]) => Promise<void>> = {
  init: initCommand,
  open: openCommand,
  observe: observeCommand,
  targets: targetsCommand,
  operations: operationsCommand,
  ops: operationsCommand,
  inspect: inspectCommand,
  run: runCommand,
  ask: askCommand,
  export: exportCommand,
  import: importCommand,
  eval: evalCommand,
  benchmark: benchmarkCommand,
  mcp: mcpCommand,
  traces: tracesCommand,
  trace: tracesCommand,
  doctor: doctorCommand,
};

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }
  if (command === '--version' || command === '-v' || command === 'version') {
    out('0.1.0');
    return;
  }

  const handler = HANDLERS[command];
  if (!handler) {
    renderError(
      Object.assign(new Error(), {
        name: 'GhostError',
        code: 'unknown_command',
        title: `Unknown command "${command}"`,
        detail: `GhostAPI has no "${command}" command.`,
        remedy: 'Run `ghostapi help` to see what is available.',
        toJSON: () => ({}),
      }),
    );
    process.exitCode = 1;
    return;
  }

  if (rest.includes('--help') || rest.includes('-h')) {
    printHelp();
    return;
  }

  await handler(rest);
}

main().catch((error: unknown) => {
  renderError(error);
  process.exitCode = isGhostError(error) ? 2 : 1;
});
