import { check, discoveredWorkspace, fetchJson, ghostapi, ghostapiJson, pass, readJson } from './lib.mjs';
import { join } from 'node:path';

const { target, cwd, storeRoot } = await discoveredWorkspace();
try {
  const title = `Replayed without the UI ${Date.now()}`;

  const before = ghostapiJson(['run', 'listTodos', JSON.stringify({ status: 'active' })], { cwd });
  const countBefore = before.data.todos.length;

  const result = ghostapiJson(
    ['run', 'createTodo', JSON.stringify({ title, projectId: 'prj_home', priority: 'high' })],
    { cwd },
  );
  check(result.ok === true, 'the operation did not report success');
  check(result.transport === 'http', `the operation ran over "${result.transport}", not http`);
  check(result.status === 201, `the API returned ${result.status}, expected 201`);
  check(result.data.todo.title === title, 'the created todo does not carry the requested title');
  check(result.data.todo.priority === 'high', 'the created todo does not carry the requested priority');
  check(typeof result.traceId === 'string' && result.traceId.startsWith('trace_'), 'no trace id emitted');

  // Confirm against the application itself, not against GhostAPI's own answer.
  const auth = await readJson(join(storeRoot, 'targets', (await readJson(join(storeRoot, 'config.json'))).defaultTarget, 'auth.json'));
  const cookie = auth.cookies.map((entry) => `${entry.name}=${entry.value}`).join('; ');
  const listed = await fetchJson(`${target.url}/api/todos?status=active`, { headers: { cookie } });
  check(
    listed.body.todos.some((todo) => todo.title === title),
    'the todo is not present in the application after the replay',
  );
  check(
    listed.body.todos.length === countBefore + 1,
    `expected one new todo, found ${listed.body.todos.length - countBefore}`,
  );

  // The point of the exercise: no browser was involved.
  check(result.latencyMs < 2_000, `the replay took ${result.latencyMs}ms, which suggests a browser started`);

  const inspected = ghostapiJson(['inspect', 'createTodo'], { cwd });
  check(inspected.verified === true, 'a successful replay did not mark the operation verified');
  check(inspected.confidence >= 0.97, `confidence after verification is ${inspected.confidence}`);

  const invalid = ghostapi(['run', 'createTodo', JSON.stringify({ title: 1 })], { cwd });
  check(invalid.code !== 0, 'an invalid input was accepted');
  check(/expected string/i.test(invalid.stderr), `the validation error was unhelpful:\n${invalid.stderr}`);

  const destructive = ghostapi(['run', 'deleteTodo', JSON.stringify({ todoId: 'todo_x' })], { cwd });
  check(destructive.code !== 0, 'a destructive operation ran without confirmation');
  check(/--yes/.test(destructive.stderr), 'the confirmation prompt does not say how to proceed');

  process.stdout.write(`createTodo replayed over HTTP in ${result.latencyMs}ms\n`);
  pass('GATE_G6_RUN_OK');
} finally {
  await target.stop();
}
