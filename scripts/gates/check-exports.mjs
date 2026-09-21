import { spawnSync } from 'node:child_process';
import { readFile, readdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { REPO, check, discoveredWorkspace, exists, ghostapiJson, pass } from './lib.mjs';

const ALLOWED_FRONTMATTER = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];

const { target, cwd } = await discoveredWorkspace();
try {
  const outDir = join(cwd, 'out');

  // ---- Agent Skill --------------------------------------------------------
  const skill = ghostapiJson(['export', 'skill', '--out', outDir], { cwd });
  const skillDir = skill.outDir;
  const skillMd = await readFile(join(skillDir, 'SKILL.md'), 'utf8');

  check(skillMd.startsWith('---\n'), 'SKILL.md does not open with frontmatter');
  const frontmatter = skillMd.split('---')[1] ?? '';
  const keys = [...frontmatter.matchAll(/^([a-z-]+):/gm)].map((match) => match[1]);
  for (const key of keys) {
    check(ALLOWED_FRONTMATTER.includes(key), `SKILL.md uses the non-spec frontmatter key "${key}"`);
  }
  check(keys.includes('name') && keys.includes('description'), 'SKILL.md lacks a required key');

  const name = /^name:\s*"?([^"\n]+)"?/m.exec(frontmatter)?.[1];
  check(name === basename(skillDir), `SKILL.md name "${name}" does not match its directory`);
  check(/^[a-z0-9-]+$/.test(name), `"${name}" is not a legal skill name`);
  check(!name.includes('--') && !name.startsWith('-') && !name.endsWith('-'), `"${name}" breaks the name rules`);
  check(name.length <= 64, 'the skill name is longer than 64 characters');

  const description = /^description:\s*"(.+)"$/m.exec(frontmatter)?.[1];
  check(Boolean(description), 'SKILL.md has no description');
  check(!/[<>]/.test(description), 'the description contains angle brackets, which the spec rejects');
  check(description.length <= 1024, 'the description exceeds the 1024 character limit');

  check(skillMd.includes('destructive'), 'SKILL.md does not tell an agent about destructive operations');
  check(skillMd.includes('ghostapi run'), 'SKILL.md does not teach how to run an operation');
  check(skillMd.includes('ghostapi open'), 'SKILL.md does not teach how to re-authenticate');
  check(await exists(join(skillDir, 'references', 'operations.md')), 'the catalogue reference is missing');
  const body = skillMd.split('---').slice(2).join('---');
  check(body.split('\n').length < 200, 'SKILL.md is too long; the catalogue belongs in references/');

  const catalogue = await readFile(join(skillDir, 'references', 'operations.md'), 'utf8');
  check(catalogue.includes('createTodo'), 'the catalogue reference lists no operations');

  // ---- TypeScript client --------------------------------------------------
  const ts = ghostapiJson(['export', 'ts', '--out', outDir], { cwd });
  for (const file of ['client.ts', 'types.ts', 'runtime.ts', 'operations.json', 'tsconfig.json', 'package.json']) {
    check(await exists(join(ts.outDir, file)), `the TypeScript export is missing ${file}`);
  }

  const types = await readFile(join(ts.outDir, 'types.ts'), 'utf8');
  check(/export interface CreateTodoInput/.test(types), 'no typed input was generated for createTodo');
  check(/'high'\s*\|\s*'low'\s*\|\s*'normal'/.test(types), `the inferred enum was not rendered as a union:\n${types.slice(0, 400)}`);

  const client = await readFile(join(ts.outDir, 'client.ts'), 'utf8');
  check(/export function createGhostClient/.test(client), 'no createGhostClient factory was generated');
  check(/async createTodo\(/.test(client), 'no createTodo method was generated');
  check(/export class [A-Za-z][A-Za-z0-9]*Client/.test(client), 'the generated class name is not a legal identifier');

  const tsc = spawnSync(
    process.execPath,
    [join(REPO, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(ts.outDir, 'tsconfig.json')],
    { encoding: 'utf8', timeout: 180_000 },
  );
  check(tsc.status === 0, `the generated client does not compile:\n${tsc.stdout}\n${tsc.stderr}`);

  // ---- No credentials anywhere -------------------------------------------
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.push(full);
    }
  }
  await walk(outDir);
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    check(!/demo_session=/.test(content), `${file} contains a session cookie value`);
  }

  process.stdout.write(`skill "${name}" and a compiling TypeScript client exported\n`);
  pass('GATE_G10_EXPORTS_OK');
} finally {
  await target.stop();
  await rm(join(cwd, 'out'), { recursive: true, force: true });
}
