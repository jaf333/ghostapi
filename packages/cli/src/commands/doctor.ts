import { access, constants } from 'node:fs/promises';
import { platform, release } from 'node:os';
import { checkBrowserRuntime } from '@ghostapi/browser';
import { selectEngine } from '@ghostapi/decision';
import { boolFlag, parse } from '../args.js';
import { openStore } from '../context.js';
import { emitJson, heading, note, out, style, symbols } from '../ui.js';

export interface Check {
  readonly name: string;
  readonly status: 'ok' | 'warn' | 'fail';
  readonly detail: string;
  readonly remedy?: string;
}

const CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'],
  win32: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'],
};

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reports what works and what does not, with the fix next to each problem.
 * Every check answers a question someone has actually had to debug.
 */
export async function runChecks(): Promise<Check[]> {
  const checks: Check[] = [];

  const [major = '0'] = process.versions.node.split('.');
  checks.push({
    name: 'node',
    status: Number(major) >= 20 ? 'ok' : 'fail',
    detail: `v${process.versions.node} on ${platform()} ${release()}`,
    ...(Number(major) >= 20 ? {} : { remedy: 'GhostAPI needs Node 20.11 or newer.' }),
  });

  const candidates = CHROME_PATHS[platform()] ?? [];
  const found: string[] = [];
  for (const candidate of candidates) {
    if (await exists(candidate)) found.push(candidate);
  }
  checks.push({
    name: 'chrome',
    status: found.length > 0 ? 'ok' : 'warn',
    detail: found[0] ?? 'no system Chrome found',
    ...(found.length > 0
      ? {}
      : {
          remedy:
            'Install Google Chrome, or set "browserChannel": "" in .ghostapi/config.json to use a Playwright-managed build (run `npx playwright install chromium` first).',
        }),
  });

  const runtime = await checkBrowserRuntime();
  checks.push({
    name: 'browser runtime',
    status: runtime.ok ? 'ok' : 'fail',
    detail: runtime.detail,
    ...(runtime.ok ? {} : { remedy: 'Reinstall dependencies with `pnpm install`.' }),
  });

  const engine = await selectEngine('auto');
  checks.push({
    name: 'decision engine',
    status: 'ok',
    detail:
      engine.engine.name === 'heuristic'
        ? 'heuristic (deterministic, offline)'
        : `${engine.engine.name} (hosted decision model)`,
    ...(engine.engine.name === 'heuristic'
      ? {
          remedy:
            'Optional: set TYPESAFE_API_KEY (Jev) or AI_GATEWAY_API_KEY to route intents with a decision model.',
        }
      : {}),
  });

  const store = await openStore();
  const config = await store.config();
  const targets = await store.listTargets();
  checks.push({
    name: 'workspace',
    status: 'ok',
    detail: `${store.paths.root} · ${targets.length} target(s) · browser channel "${config.browserChannel}"`,
  });

  for (const target of targets) {
    const auth = await store.readAuth(target.slug);
    if (!auth) {
      checks.push({
        name: `session:${target.slug}`,
        status: 'warn',
        detail: 'no stored browser session',
        remedy: `Run \`ghostapi open ${target.startUrl}\` and sign in.`,
      });
      continue;
    }
    const soonest = auth.cookies
      .map((cookie) => cookie.expires)
      .filter((expires) => expires > 0)
      .sort((a, b) => a - b)[0];
    const expired = soonest !== undefined && soonest * 1000 < Date.now();
    checks.push({
      name: `session:${target.slug}`,
      status: expired ? 'warn' : 'ok',
      detail: expired
        ? `session cookies expired ${new Date(soonest * 1000).toISOString()}`
        : `${auth.cookies.length} cookie(s), captured ${new Date(auth.updatedAt).toISOString()}`,
      ...(expired ? { remedy: `Run \`ghostapi open ${target.startUrl}\` and sign in again.` } : {}),
    });
  }

  return checks;
}

export async function doctorCommand(argv: readonly string[]): Promise<void> {
  const parsed = parse(argv, {});
  const checks = await runChecks();

  if (boolFlag(parsed, 'json')) {
    emitJson(checks);
    return;
  }

  heading('GhostAPI doctor');
  out();
  const width = checks.reduce((max, check) => Math.max(max, check.name.length), 0);
  for (const check of checks) {
    const mark = check.status === 'ok' ? symbols.ok : check.status === 'warn' ? style.yellow('!') : symbols.fail;
    out(`  ${mark} ${style.gray(check.name.padEnd(width))}  ${check.detail}`);
    if (check.remedy) out(`      ${style.cyan(check.remedy)}`);
  }
  out();
  const failures = checks.filter((check) => check.status === 'fail').length;
  if (failures > 0) {
    note(`${failures} check(s) failed.`);
    process.exitCode = 1;
  } else {
    note('Ready.');
  }
  out();
}
