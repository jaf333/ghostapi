import { join } from 'node:path';
import { check, discoveredWorkspace, fetchJson, ghostapi, ghostapiJson, pass, readJson } from './lib.mjs';

const { target, cwd, storeRoot } = await discoveredWorkspace();
try {
  const operations = ghostapiJson(['operations'], { cwd });
  const withFallback = operations.filter((operation) => operation.transport === 'http');
  check(withFallback.length > 0, 'no operation has an HTTP transport to fall back from');

  const createTodo = ghostapiJson(['inspect', 'createTodo'], { cwd });
  check(createTodo.fallbacks.length > 0, 'createTodo kept no browser fallback');
  const fallback = createTodo.fallbacks[0];
  check(fallback.type === 'browser', `the fallback transport is "${fallback.type}"`);
  check(fallback.steps.length >= 3, 'the browser fallback records too few steps to be real');
  check(
    fallback.steps.some((step) => step.action === 'fill' && step.value.kind === 'input'),
    'the browser fallback binds no operation input to a form field',
  );
  check(
    fallback.steps.some((step) => step.action === 'click'),
    'the browser fallback never activates anything',
  );
  check(typeof fallback.expectRequestPath === 'string', 'the browser fallback asserts no backend request');

  const title = `Created through the browser ${Date.now()}`;
  const result = ghostapiJson(
    [
      'run',
      'createTodo',
      JSON.stringify({ title, projectId: 'prj_home', priority: 'low' }),
      '--transport',
      'browser',
    ],
    { cwd, timeoutMs: 180_000 },
  );
  check(result.ok === true, 'the browser fallback did not report success');
  check(result.transport === 'browser', `the run used "${result.transport}" instead of the browser`);

  const config = await readJson(join(storeRoot, 'config.json'));
  const auth = await readJson(join(storeRoot, 'targets', config.defaultTarget, 'auth.json'));
  const cookie = auth.cookies.map((entry) => `${entry.name}=${entry.value}`).join('; ');
  const listed = await fetchJson(`${target.url}/api/todos?status=active`, { headers: { cookie } });
  check(
    listed.body.todos.some((todo) => todo.title === title),
    'the browser fallback reported success but changed nothing in the application',
  );

  process.stdout.write(`browser fallback created a record in ${result.latencyMs}ms\n`);
  pass('GATE_G8_FALLBACK_OK');
} finally {
  await target.stop();
}
