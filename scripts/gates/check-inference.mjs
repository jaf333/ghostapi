import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO, check, discoveredWorkspace, ghostapiJson, listFilesRecursive, pass } from './lib.mjs';

// The discovery engine must be generic: no knowledge of the reference target
// may reach its executable code. Comments and doc examples are exempt, because
// explaining a rule with a concrete example is not hardcoding it.
const FORBIDDEN = ['todo', 'tasklet', 'demo-target', 'prj_', 'api/todos', 'demo_session'];

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

function offendingTerms(source) {
  const code = stripComments(source).toLowerCase();
  return FORBIDDEN.filter((term) => code.includes(term.toLowerCase()));
}

// Positive control: the scanner must fire on a planted term, otherwise the
// absence it reports below would prove nothing.
const control = `const endpoint = "/api/todos"; // a comment mentioning tasklet`;
check(
  offendingTerms(control).includes('api/todos'),
  'the target-agnostic scanner failed its positive control',
);
check(
  !offendingTerms('// this comment mentions a todo and nothing else').includes('todo'),
  'the scanner does not exempt comments, so it would flag documentation',
);

const sources = (await listFilesRecursive(join(REPO, 'packages', 'discovery', 'src'))).filter(
  (file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('fixtures.ts'),
);
check(sources.length > 5, 'the discovery engine sources were not found');
for (const file of sources) {
  const offending = offendingTerms(await readFile(file, 'utf8'));
  check(
    offending.length === 0,
    `the discovery engine hardcodes ${offending.join(', ')} in ${file.replace(REPO, '.')}`,
  );
}

const { target, cwd } = await discoveredWorkspace();
try {
  const operations = ghostapiJson(['operations'], { cwd });
  const byName = new Map(operations.map((operation) => [operation.name, operation]));

  for (const expected of ['createTodo', 'listTodos', 'updateTodo', 'deleteTodo', 'archiveTodo']) {
    check(byName.has(expected), `expected to derive "${expected}", got: ${[...byName.keys()].join(', ')}`);
  }
  for (const name of byName.keys()) {
    check(/^[a-z][A-Za-z0-9]*$/.test(name), `"${name}" is not a camelCase operation name`);
    check(!/^(get|post|put|patch|delete)api/i.test(name), `"${name}" is a method-and-path name`);
  }

  const createTodo = byName.get('createTodo');
  check(createTodo.verb === 'create', `createTodo has verb "${createTodo.verb}"`);
  check(createTodo.transport === 'http', 'createTodo did not derive an HTTP transport');
  check(createTodo.destructive === false, 'createTodo was wrongly marked destructive');

  const properties = createTodo.inputs.properties ?? {};
  check(properties.title?.type === 'string', 'createTodo.title was not inferred as a string');
  check((createTodo.inputs.required ?? []).includes('title'), 'createTodo.title was not inferred as required');
  check(
    Array.isArray(properties.priority?.enum) && properties.priority.enum.length === 3,
    `createTodo.priority was not inferred as a three-member enum: ${JSON.stringify(properties.priority)}`,
  );
  check(
    ['low', 'normal', 'high'].every((value) => properties.priority.enum.includes(value)),
    'the inferred priority enum does not match what was observed',
  );
  check(properties.projectId?.type === 'string', 'createTodo.projectId was not inferred');

  const deleteTodo = byName.get('deleteTodo');
  check(deleteTodo.destructive === true, 'deleteTodo was not marked destructive');
  check(byName.get('archiveTodo').destructive === true, 'archiveTodo was not marked destructive');
  check(byName.get('listTodos').destructive === false, 'listTodos was wrongly marked destructive');

  const inspected = ghostapiJson(['inspect', 'createTodo'], { cwd });
  check(inspected.observationCount >= 5, `createTodo cites only ${inspected.observationCount} observations`);
  check(inspected.evidence.some((item) => item.kind === 'network'), 'createTodo cites no network evidence');
  check(inspected.evidence.some((item) => item.kind === 'ui'), 'createTodo cites no UI evidence');
  check(inspected.uiTriggers.length > 0, 'createTodo records no UI trigger');
  check(inspected.confidence > 0.75, `createTodo confidence is only ${inspected.confidence}`);
  check(inspected.confidence < 0.95, 'confidence reached the verified band without a replay');
  check(inspected.auth.strategy === 'browser-session', `createTodo auth is ${inspected.auth.strategy}`);
  check(
    inspected.transport.urlTemplate.endsWith('/api/todos'),
    `createTodo URL template is ${inspected.transport.urlTemplate}`,
  );

  const updateTodo = ghostapiJson(['inspect', 'updateTodo'], { cwd });
  check(
    updateTodo.transport.urlTemplate.includes('{todoId}'),
    `updateTodo did not template its path: ${updateTodo.transport.urlTemplate}`,
  );
  check(updateTodo.transport.pathParams.includes('todoId'), 'updateTodo declares no path parameter');

  process.stdout.write(`derived ${operations.length} operations from observation alone\n`);
  pass('GATE_G5_INFERENCE_OK');
} finally {
  await target.stop();
}
