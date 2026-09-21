import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO, check, exists, pass, readJson } from './lib.mjs';

const base = await readJson(join(REPO, 'tsconfig.base.json'));
check(base.compilerOptions.strict === true, 'tsconfig.base.json does not enable strict mode');
check(base.compilerOptions.noUncheckedIndexedAccess === true, 'noUncheckedIndexedAccess is not enabled');

const build = spawnSync('npx', ['turbo', 'run', 'build', '--force'], {
  cwd: REPO,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  timeout: 600_000,
});
check(build.status === 0, `turbo build exited ${build.status}\n${build.stdout}\n${build.stderr}`);

const packages = await readdir(join(REPO, 'packages'));
for (const name of packages) {
  const dist = join(REPO, 'packages', name, 'dist', 'index.js');
  const binary = join(REPO, 'packages', name, 'dist', 'bin.js');
  check(
    (await exists(dist)) || (await exists(binary)),
    `packages/${name} produced no build output`,
  );
}

const typecheck = spawnSync('npx', ['turbo', 'run', 'typecheck'], {
  cwd: REPO,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  timeout: 600_000,
});
check(typecheck.status === 0, `typecheck exited ${typecheck.status}\n${typecheck.stdout}`);

pass('GATE_G1_BUILD_OK');
