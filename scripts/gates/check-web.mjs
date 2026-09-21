import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { REPO, check, discoveredWorkspace, exists, pass } from './lib.mjs';

const WEB = join(REPO, 'apps', 'web');
const PORT = 4399;

const { target, cwd } = await discoveredWorkspace();
let server;
try {
  const build = spawnSync('npx', ['next', 'build'], {
    cwd: WEB,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 600_000,
  });
  check(build.status === 0, `next build exited ${build.status}\n${build.stdout}\n${build.stderr}`);
  check(await exists(join(WEB, '.next', 'BUILD_ID')), 'next build produced no build output');

  server = spawn('npx', ['next', 'start', '--port', String(PORT)], {
    cwd: WEB,
    env: { ...process.env, GHOSTAPI_CWD: cwd },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const base = `http://127.0.0.1:${PORT}`;
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    try {
      const probe = await fetch(base);
      ready = probe.ok;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 400));
    }
  }
  check(ready, 'the web UI did not start');

  const home = await (await fetch(base)).text();
  check(home.includes('GhostAPI'), 'the home page does not render');
  check(home.includes('Turn web apps into agent-native operations'), 'the tagline is missing');

  // The listing must come from the real store, not from a fixture.
  const slugMatch = /\/t\/([a-z0-9-]+)"/.exec(home);
  check(Boolean(slugMatch), `the home page lists no target:\n${home.slice(0, 600)}`);
  const slug = slugMatch[1];

  const targetPage = await (await fetch(`${base}/t/${slug}`)).text();
  for (const name of ['createTodo', 'listTodos', 'deleteTodo']) {
    check(targetPage.includes(name), `the target page does not list ${name}`);
  }
  check(targetPage.includes('Network feed'), 'the target page shows no network feed');
  check(/\/api\/todos/.test(targetPage), 'the network feed shows no observed requests');

  const operationPage = await (await fetch(`${base}/t/${slug}/o/createTodo`)).text();
  check(operationPage.includes('Evidence'), 'the operation page shows no evidence');
  check(operationPage.includes('UI triggers observed'), 'the operation page shows no UI triggers');
  check(/high \| low \| normal|low \| normal \| high/.test(operationPage), 'the inferred enum is not rendered');
  check(operationPage.includes('browser session cookies'), 'the operation page does not describe auth');
  check(operationPage.includes('Run'), 'the operation page offers no way to run the operation');

  const missing = await fetch(`${base}/t/${slug}/o/doesNotExist`);
  check(missing.status === 404, `an unknown operation returned ${missing.status}, expected 404`);

  process.stdout.write(`web UI built and rendered ${slug} from the real store\n`);
  pass('GATE_G14_WEB_OK');
} finally {
  server?.kill('SIGTERM');
  await target.stop();
}
