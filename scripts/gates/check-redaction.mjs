import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { check, discoveredWorkspace, ghostapiJson, listFilesRecursive, pass, readJson } from './lib.mjs';

const { target, cwd, storeRoot } = await discoveredWorkspace();
try {
  const config = await readJson(join(storeRoot, 'config.json'));
  const authFile = join(storeRoot, 'targets', config.defaultTarget, 'auth.json');
  const auth = await readJson(authFile);
  check(auth.cookies.length > 0, 'no session was captured, so there is nothing to prove was kept out');

  // The live secrets for this session. Everything below asserts their absence.
  const secrets = [
    ...auth.cookies.map((cookie) => cookie.value),
    'ghost', // the password typed into the login form
  ].filter((value) => typeof value === 'string' && value.length >= 6);
  check(secrets.length > 0, 'no secret values were available to test against');

  function scan(content) {
    return secrets.filter((secret) => content.includes(secret));
  }

  // Positive control: the scanner must fire on a file that does contain a secret.
  const control = join(cwd, 'control.txt');
  await writeFile(control, `cookie value is ${secrets[0]}\n`, 'utf8');
  check(scan(await readFile(control, 'utf8')).length > 0, 'the secret scanner failed its positive control');
  await rm(control, { force: true });

  // Everything GhostAPI persists, except the session record itself.
  const stored = (await listFilesRecursive(storeRoot)).filter(
    (file) => file !== authFile && !file.includes(`${join('targets', config.defaultTarget, 'profile')}`),
  );
  check(stored.length > 5, 'the store looks empty, so this gate would prove nothing');
  for (const file of stored) {
    const content = await readFile(file, 'utf8').catch(() => '');
    const found = scan(content);
    check(found.length === 0, `${file.replace(storeRoot, '.ghostapi')} contains a credential value`);
  }

  // Everything GhostAPI exports.
  const outDir = join(cwd, 'out');
  ghostapiJson(['export', 'mcp', '--out', outDir], { cwd });
  ghostapiJson(['export', 'skill', '--out', outDir], { cwd });
  ghostapiJson(['export', 'ts', '--out', outDir], { cwd });
  ghostapiJson(['export', 'target', '--out', join(cwd, 'target.ghost.json')], { cwd });

  const exported = [...(await listFilesRecursive(outDir)), join(cwd, 'target.ghost.json')];
  check(exported.length > 8, 'the exports look empty');
  for (const file of exported) {
    const content = await readFile(file, 'utf8').catch(() => '');
    const found = scan(content);
    check(found.length === 0, `${file} contains a credential value`);
  }

  // Everything GhostAPI prints.
  const printed = [
    ghostapiJson(['operations'], { cwd }),
    ghostapiJson(['inspect', 'signIn'], { cwd }),
    ghostapiJson(['run', 'listTodos', JSON.stringify({ status: 'active' })], { cwd }),
  ];
  for (const payload of printed) {
    check(scan(JSON.stringify(payload)).length === 0, 'a CLI response carried a credential value');
  }

  // The password field was observed but never stored, even redacted-in-shape.
  const signIn = ghostapiJson(['inspect', 'signIn'], { cwd });
  check(
    signIn.inputs.properties.password?.description === 'redacted credential',
    'the password input was not recorded as a redacted credential',
  );
  check(
    !JSON.stringify(signIn).includes('"examples"') || !JSON.stringify(signIn.inputs.properties.password).includes('examples'),
    'the password input carries an example value',
  );

  // The session record itself is the one place a credential lives, and it is
  // deliberately not part of any export.
  const bundle = await readJson(join(cwd, 'target.ghost.json'));
  check(JSON.stringify(bundle).includes('browser-session'), 'the bundle does not describe how to authenticate');
  check(scan(JSON.stringify(bundle)).length === 0, 'the target bundle carries the session');

  process.stdout.write(
    `scanned ${stored.length} stored files and ${exported.length} exported files for ${secrets.length} live secrets\n`,
  );
  pass('GATE_G12_REDACTION_OK');
} finally {
  await target.stop();
}
