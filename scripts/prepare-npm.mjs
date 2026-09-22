#!/usr/bin/env node
// Prepares the workspace for `pnpm -r publish`.
//
// npm always ships README and LICENSE from a package's own directory, and
// nothing else crosses package boundaries. This copies them in, rewriting the
// README's repo-relative links to absolute ones so they survive on npmjs.com.
//
// Everything written here is generated and gitignored. Run it after `pnpm build`.

import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = 'https://raw.githubusercontent.com/jaf333/ghostapi/main';
const BLOB = 'https://github.com/jaf333/ghostapi/blob/main';

const PACKAGES = [
  'packages/browser',
  'packages/cli',
  'packages/core',
  'packages/decision',
  'packages/discovery',
  'packages/eval',
  'packages/executor',
  'packages/exporters',
  'packages/store',
];

/** The npm page for the CLI is the project's front door, so it gets the real README. */
const README_PACKAGE = 'packages/cli';

function absolutiseLinks(markdown) {
  return markdown
    .replace(/(<img[^>]+src=")(?!https?:)([^"]+)(")/g, (_m, before, path, after) => `${before}${RAW}/${path}${after}`)
    .replace(/(!\[[^\]]*\]\()(?!https?:)([^)]+)(\))/g, (_m, before, path, after) => `${before}${RAW}/${path}${after}`)
    .replace(/(\[[^\]]*\]\()(?!https?:|#)([^)]+\.md)(\))/g, (_m, before, path, after) => `${before}${BLOB}/${path}${after}`);
}

const license = join(ROOT, 'LICENSE');
for (const pkg of PACKAGES) {
  copyFileSync(license, join(ROOT, pkg, 'LICENSE'));
}

const readme = absolutiseLinks(readFileSync(join(ROOT, 'README.md'), 'utf8'));
writeFileSync(join(ROOT, README_PACKAGE, 'README.md'), readme);

console.log(`prepare-npm: LICENSE copied into ${PACKAGES.length} package(s)`);
console.log(`prepare-npm: README written to ${README_PACKAGE}/README.md with absolute links`);
