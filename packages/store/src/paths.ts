import { join } from 'node:path';
import { assertSafePathSegment } from '@ghostapi/core';

export const STORE_DIR_NAME = '.ghostapi';

export interface StorePaths {
  readonly root: string;
  readonly configFile: string;
  readonly targetsDir: string;
}

export function storePaths(root: string): StorePaths {
  return {
    root,
    configFile: join(root, 'config.json'),
    targetsDir: join(root, 'targets'),
  };
}

export interface TargetPaths {
  readonly dir: string;
  readonly targetFile: string;
  readonly authFile: string;
  readonly operationsDir: string;
  readonly observationsDir: string;
  readonly sessionsDir: string;
  readonly tracesDir: string;
  readonly evalsDir: string;
  readonly profileDir: string;
}

export function targetPaths(paths: StorePaths, slug: string): TargetPaths {
  const dir = join(paths.targetsDir, assertSafePathSegment(slug));
  return {
    dir,
    targetFile: join(dir, 'target.json'),
    authFile: join(dir, 'auth.json'),
    operationsDir: join(dir, 'operations'),
    observationsDir: join(dir, 'observations'),
    sessionsDir: join(dir, 'sessions'),
    tracesDir: join(dir, 'traces'),
    evalsDir: join(dir, 'evals'),
    profileDir: join(dir, 'profile'),
  };
}
