#!/usr/bin/env node
// Runs every gate in GATES.md end to end.
//
// This is the project's own CI: portable, dependency-free and runnable by any
// runner or by a person on a laptop. `pnpm verify`.
import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(HERE);
const only = process.argv.slice(2);

const files = (await readdir(join(HERE, 'gates')))
  .filter((name) => name.startsWith('check-') && name.endsWith('.mjs'))
  .sort();

const selected = only.length > 0 ? files.filter((name) => only.some((arg) => name.includes(arg))) : files;
if (selected.length === 0) {
  process.stderr.write(`No gate matched: ${only.join(', ')}\n`);
  process.exit(1);
}

const results = [];
for (const name of selected) {
  process.stdout.write(`\n── ${name} ${'─'.repeat(Math.max(0, 52 - name.length))}\n`);
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [join(HERE, 'gates', name)], {
    cwd: REPO,
    stdio: 'inherit',
    timeout: 900_000,
  });
  results.push({ name, ok: result.status === 0, seconds: Math.round((Date.now() - startedAt) / 1000) });
}

process.stdout.write('\n');
const width = results.reduce((max, entry) => Math.max(max, entry.name.length), 0);
for (const entry of results) {
  process.stdout.write(`${entry.ok ? '✓' : '✗'} ${entry.name.padEnd(width)}  ${entry.seconds}s\n`);
}

const failed = results.filter((entry) => !entry.ok);
process.stdout.write(`\n${results.length - failed.length}/${results.length} gates passed\n`);
process.exit(failed.length === 0 ? 0 : 1);
