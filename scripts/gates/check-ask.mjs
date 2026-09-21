import { check, discoveredWorkspace, ghostapi, ghostapiJson, pass } from './lib.mjs';

const { target, cwd } = await discoveredWorkspace();
try {
  const result = ghostapiJson(['ask', 'create a todo called buy coffee'], { cwd });

  check(result.operation === 'createTodo', `the router chose "${result.operation}"`);
  check(result.decision.confidence > 0.5, `routing confidence was only ${result.decision.confidence}`);
  check(typeof result.decision.engine === 'string', 'the decision did not report which engine made it');
  check(result.inputs.title === 'buy coffee', `the title was bound as "${result.inputs.title}"`);
  check(result.executed === true, 'the routed operation was not executed');
  check(result.status === 201, `execution returned ${result.status}`);
  check(result.data.todo.title === 'buy coffee', 'the created todo does not match the intent');
  check(typeof result.traceId === 'string', 'no trace was recorded for the routed execution');

  // Routing must choose from the known catalogue and nothing else.
  const operations = ghostapiJson(['operations'], { cwd }).map((operation) => operation.name);
  check(operations.includes(result.decision.choice), 'the router returned an operation outside the catalogue');

  const read = ghostapiJson(['ask', 'show me all my todos', '--dry-run'], { cwd });
  check(read.operation === 'listTodos', `"show me all my todos" routed to ${read.operation}`);
  check(read.executed === false, 'a dry run executed anyway');

  const search = ghostapiJson(['ask', 'find todos about milk', '--dry-run'], { cwd });
  check(search.operation === 'searchTodos' || search.operation === 'listTodos', `search routed to ${search.operation}`);
  check(search.inputs.query === 'milk', `the search term was bound as "${search.inputs.query}"`);

  // A destructive intent must not be carried out without confirmation.
  const destructive = ghostapi(['ask', 'delete the todo todoId=todo_zzz'], { cwd });
  check(destructive.code !== 0, 'a destructive intent executed without confirmation');
  check(/--yes|confirm/i.test(destructive.stderr), 'the refusal does not explain how to confirm');

  // An intent that names no identifier must refuse rather than guess one.
  const guessy = ghostapi(['ask', 'archive that todo', '--json'], { cwd });
  const guessyPayload = JSON.parse(guessy.stdout);
  check(guessyPayload.executed === false, 'GhostAPI executed an operation it had no identifier for');
  check(
    Array.isArray(guessyPayload.missing) && guessyPayload.missing.includes('todoId'),
    'GhostAPI guessed an identifier it had not been given',
  );

  process.stdout.write(
    `routed with ${result.decision.engine} at ${(result.decision.confidence * 100).toFixed(1)}% confidence\n`,
  );
  pass('GATE_G7_ASK_OK');
} finally {
  await target.stop();
}
