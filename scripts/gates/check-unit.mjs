import { spawnSync } from 'node:child_process';
import { REPO, check, pass } from './lib.mjs';

const result = spawnSync('npx', ['turbo', 'run', 'test:unit'], {
  cwd: REPO,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  timeout: 900_000,
});
const output = `${result.stdout}\n${result.stderr}`;
check(result.status === 0, `unit tests exited ${result.status}\n${output}`);

const totals = [...output.matchAll(/Tests\s+(\d+)\s+passed\s+\((\d+)\)/g)];
check(totals.length > 0, `no vitest summary found in the output:\n${output}`);
const passed = totals.reduce((sum, match) => sum + Number(match[1]), 0);
check(passed >= 150, `expected at least 150 unit tests, counted ${passed}`);
check(!/\d+ failed/.test(output), `a suite reported failures:\n${output}`);

// The areas the ledger names must each be exercised somewhere.
const required = ['redaction', 'safety', 'schema-infer', 'correlate', 'naming', 'serialization', 'export'];
for (const area of required) {
  check(output.includes(`${area}.test.ts`), `no unit tests found for "${area}"`);
}

process.stdout.write(`unit tests passed: ${passed}\n`);
pass('GATE_G2_UNIT_OK');
