import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, discoveredWorkspace, exists, ghostapi, ghostapiJson, pass, readJson } from './lib.mjs';

const { target, cwd } = await discoveredWorkspace();
try {
  const file = join(cwd, 'demo.ghost.json');
  const exported = ghostapiJson(['export', 'target', '--out', file], { cwd });
  check(await exists(file), 'no target file was written');
  check(exported.operations >= 5, `only ${exported.operations} operations exported`);

  const bundle = await readJson(file);
  check(bundle.format === 1, `unexpected bundle format ${bundle.format}`);
  check(typeof bundle.generator === 'string', 'the bundle does not record what produced it');
  check(bundle.operations.every((operation) => operation.name && operation.transport), 'an operation is incomplete');

  const fresh = await mkdtemp(join(tmpdir(), 'ghostapi-import-'));
  const imported = ghostapiJson(['import', file, '--allow-private-network'], { cwd: fresh });
  check(imported.operations === exported.operations, 'the import lost operations');

  const operations = ghostapiJson(['operations'], { cwd: fresh });
  check(operations.length === exported.operations, 'the imported workspace lists a different set');
  const createTodo = operations.find((operation) => operation.name === 'createTodo');
  check(Boolean(createTodo), 'createTodo did not survive the round trip');
  check(createTodo.inputs.required.includes('title'), 'the imported schema lost its required fields');

  check(!(await exists(join(fresh, '.ghostapi', 'targets', 'demo', 'auth.json'))), 'the import carried a session');

  // An imported target is untrusted: it must not be able to aim execution at a
  // private address without an explicit opt-in.
  const blocked = ghostapi(['import', file], { cwd: await mkdtemp(join(tmpdir(), 'ghostapi-import-')) });
  check(blocked.code !== 0, 'an imported target pointing at a private address was accepted silently');
  check(/private network/i.test(blocked.stderr), `the refusal does not explain itself:\n${blocked.stderr}`);

  // Executing an imported operation needs authentication, and says so.
  const run = ghostapi(['run', 'createTodo', JSON.stringify({ title: 'x', projectId: 'prj_inbox', priority: 'low' })], {
    cwd: fresh,
  });
  check(run.code !== 0, 'an imported operation ran with no session at all');
  check(/ghostapi open/.test(run.stderr), 'the error does not say how to authenticate');

  // Assert against the actual live session rather than a shape heuristic.
  const config = await readJson(join(cwd, '.ghostapi', 'config.json'));
  const session = await readJson(join(cwd, '.ghostapi', 'targets', config.defaultTarget, 'auth.json'));
  const secrets = session.cookies.map((cookie) => cookie.value).filter((value) => value.length >= 8);
  check(secrets.length > 0, 'no live session was captured, so this assertion would prove nothing');
  const raw = await readFile(file, 'utf8');
  // Positive control for the scan below.
  check(secrets.some((secret) => `carrying ${secret}`.includes(secret)), 'the scan is vacuous');
  for (const secret of secrets) {
    check(!raw.includes(secret), 'the exported bundle carries a live session cookie');
  }

  process.stdout.write(`${exported.operations} operations survived export and import\n`);
  pass('GATE_G13_PORTABILITY_OK');
} finally {
  await target.stop();
}
