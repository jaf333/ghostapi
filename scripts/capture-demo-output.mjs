#!/usr/bin/env node
// Captures the CLI's real output for the demo, the README and the launch film.
//
//   pnpm build && node scripts/capture-demo-output.mjs [--out <dir>]
//
// Starts the reference application, replays the recorded session through a real
// browser, and writes each command's exact stdout to its own file. Nothing here
// is formatted for presentation: the point is that anything quoting GhostAPI can
// quote a file produced by GhostAPI rather than a transcript somebody typed.
//
// The workspace is a throwaway directory, so a run never touches your own
// `.ghostapi` state, and no file it writes contains a credential — redaction
// happens upstream, where evidence enters the system.

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(REPO, 'packages', 'cli', 'dist', 'bin.js');
const SERVER = join(REPO, 'apps', 'demo-target', 'dist', 'server.js');
const SESSION = join(REPO, 'examples', 'demo-session.json');

const outFlag = process.argv.indexOf('--out');
const OUT = resolve(outFlag >= 0 ? (process.argv[outFlag + 1] ?? '') : join(REPO, 'out', 'capture'));

/** Starts the reference target and resolves the URL it is listening on. */
function startTarget() {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolveUrl, rejectUrl) => {
    const timer = setTimeout(() => rejectUrl(new Error('the demo target did not start within 15s')), 15_000);
    child.stdout.on('data', (chunk) => {
      const match = /listening on (http:\/\/\S+)/.exec(String(chunk));
      if (match) {
        clearTimeout(timer);
        resolveUrl({ child, url: match[1] });
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      rejectUrl(new Error(`the demo target exited with code ${code} before it was ready`));
    });
  });
}

/** Runs one CLI command in the throwaway workspace and returns everything it printed. */
function runCli(cwd, args) {
  return new Promise((resolveOutput) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...process.env, COLUMNS: '92' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (code) => resolveOutput({ output, code }));
  });
}

const { child: target, url } = await startTarget();
const workspace = await mkdtemp(join(tmpdir(), 'ghostapi-capture-'));
await mkdir(OUT, { recursive: true });

const commands = [
  ['01-open', ['open', url, '--headless', '--script', SESSION]],
  ['02-operations', ['operations']],
  ['03-inspect', ['inspect', 'createTodo']],
  ['04-run', ['run', 'createTodo', '{"title":"Buy bread","projectId":"prj_home","priority":"high"}']],
  ['05-ask', ['ask', 'create a todo called buy coffee']],
  ['06-export', ['export', 'mcp']],
];

try {
  for (const [name, args] of commands) {
    const { output, code } = await runCli(workspace, args);
    await writeFile(join(OUT, `${name}.txt`), output);
    const status = code === 0 ? '✓' : `exit ${code}`;
    process.stdout.write(`${status} ${name}  ghostapi ${args[0]}  → ${join(OUT, `${name}.txt`)}\n`);
  }
} finally {
  target.kill('SIGKILL');
}

process.stdout.write(`\nWorkspace: ${workspace}\nTarget:    ${url}\n`);
