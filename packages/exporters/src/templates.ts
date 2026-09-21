import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Templates sit beside the build output; `dist/templates` is produced at build time. */
export async function readTemplate(name: string): Promise<string> {
  const candidates = [join(here, 'templates', name), join(here, '..', 'templates', name)];
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, 'utf8');
    } catch {
      continue;
    }
  }
  throw new Error(`GhostAPI template "${name}" is missing from the installed package.`);
}
