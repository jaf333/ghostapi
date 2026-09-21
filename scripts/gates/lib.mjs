import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CLI = join(REPO, 'packages', 'cli', 'dist', 'bin.js');
export const DEMO_SERVER = join(REPO, 'apps', 'demo-target', 'dist', 'server.js');
export const DEMO_SCRIPT = join(REPO, 'examples', 'demo-session.json');

export function fail(message) {
  process.stderr.write(`\nGATE FAILED: ${message}\n`);
  process.exit(1);
}

export function check(condition, message) {
  if (!condition) fail(message);
}

export function pass(token) {
  process.stdout.write(`\n${token}\n`);
}

/** Starts the reference target on an ephemeral port and resolves once it answers. */
export async function startTarget() {
  const child = spawn(process.execPath, [DEMO_SERVER], {
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const url = await new Promise((resolveUrl, rejectUrl) => {
    const timer = setTimeout(() => rejectUrl(new Error('demo target did not start in 15s')), 15_000);
    child.stdout.on('data', (chunk) => {
      const match = /listening on (http:\/\/\S+)/.exec(String(chunk));
      if (match) {
        clearTimeout(timer);
        resolveUrl(match[1]);
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      rejectUrl(new Error(`demo target exited with code ${code}`));
    });
  });
  return {
    url,
    async stop() {
      child.kill('SIGTERM');
    },
  };
}

export async function makeWorkspace() {
  return mkdtemp(join(tmpdir(), 'ghostapi-gate-'));
}

/** Runs the CLI in a workspace and returns stdout, stderr and the exit code. */
export function ghostapi(args, options = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', ...(options.env ?? {}) },
    timeout: options.timeoutMs ?? 180_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', code: result.status ?? 1 };
}

export function ghostapiJson(args, options = {}) {
  const result = ghostapi([...args, '--json'], options);
  if (result.code !== 0) {
    fail(`\`ghostapi ${args.join(' ')} --json\` exited ${result.code}\n${result.stderr}${result.stdout}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    return fail(`\`ghostapi ${args.join(' ')} --json\` did not print JSON:\n${result.stdout}`);
  }
}

/**
 * The shared fixture: a real browser session against the reference target,
 * producing a workspace with observations, operations and a live session.
 */
export async function discoveredWorkspace() {
  const target = await startTarget();
  const cwd = await makeWorkspace();
  const result = ghostapi(
    ['open', target.url, '--headless', '--script', DEMO_SCRIPT, '--quiet'],
    { cwd },
  );
  if (result.code !== 0) {
    await target.stop();
    fail(`discovery session failed (exit ${result.code}):\n${result.stderr}${result.stdout}`);
  }
  return { target, cwd, storeRoot: join(cwd, '.ghostapi') };
}

export async function listFilesRecursive(dir) {
  const out = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  await walk(dir);
  return out;
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  return { status: response.status, body: text.length > 0 ? JSON.parse(text) : null, headers: response.headers };
}
