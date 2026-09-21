import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { check, discoveredWorkspace, listFilesRecursive, pass } from './lib.mjs';

const { target, storeRoot } = await discoveredWorkspace();
try {
  const logs = (await listFilesRecursive(join(storeRoot, 'targets'))).filter((file) =>
    file.endsWith('.ndjson'),
  );
  check(logs.length > 0, 'the session recorded no observation log');

  const records = [];
  for (const file of logs) {
    for (const line of (await readFile(file, 'utf8')).split('\n')) {
      if (line.trim().length > 0) records.push(JSON.parse(line));
    }
  }

  const network = records.filter((record) => record.kind === 'network');
  const ui = records.filter((record) => record.kind === 'ui');
  const state = records.filter((record) => record.kind === 'state');
  check(network.length >= 10, `only ${network.length} requests captured`);
  check(ui.length >= 5, `only ${ui.length} UI interactions captured`);
  check(state.length >= 1, 'no application state changes captured');

  const create = network.find(
    (record) => record.method === 'POST' && record.path === '/api/todos' && record.status === 201,
  );
  check(Boolean(create), 'the createTodo request was not captured');
  check(
    create.requestBody && typeof create.requestBody.title === 'string',
    'the request body was not captured',
  );
  check(
    create.responseBody && create.responseBody.todo && typeof create.responseBody.todo.id === 'string',
    'the response body was not captured',
  );
  check(create.initiator !== undefined, 'the request initiator was not captured');
  check(create.durationMs >= 0, 'the request timing was not captured');

  const submit = ui.find(
    (record) =>
      record.type === 'submit' && record.formFields.some((field) => field.name === 'title'),
  );
  check(Boolean(submit), 'the todo form submission and its fields were not captured');
  const titleField = submit.formFields.find((field) => field.name === 'title');
  check(
    typeof titleField.valueSample === 'string' && titleField.valueSample.length > 0,
    'the value the user typed was not captured alongside the field',
  );
  check(typeof submit.submitterSelector === 'string', 'the form submitter was not captured');

  const analytics = network.filter((record) => record.path === '/api/events');
  check(analytics.length === 0, `analytics traffic was captured (${analytics.length} records)`);

  const passwordField = ui
    .flatMap((record) => record.formFields)
    .find((field) => field.type === 'password');
  check(Boolean(passwordField), 'the login form was never observed');
  check(passwordField.redacted === true, 'a password field was captured without being marked redacted');
  check(passwordField.valueSample === undefined, 'a password value was captured');

  process.stdout.write(
    `captured ${network.length} requests, ${ui.length} interactions, ${state.length} state changes\n`,
  );
  pass('GATE_G4_CAPTURE_OK');
} finally {
  await target.stop();
}
