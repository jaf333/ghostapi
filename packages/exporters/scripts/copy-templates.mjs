import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
await mkdir(join(root, 'dist'), { recursive: true });
await cp(join(root, 'templates'), join(root, 'dist', 'templates'), { recursive: true });
