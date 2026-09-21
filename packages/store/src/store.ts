import { mkdir, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import {
  configSchema,
  DEFAULT_CONFIG,
  ErrorCodes,
  GhostError,
  observationSchema,
  operationSchema,
  sessionSchema,
  slugify,
  TARGET_BUNDLE_FORMAT,
  targetBundleSchema,
  targetSchema,
  type GhostConfig,
  type Observation,
  type Operation,
  type Session,
  type Target,
  type TargetBundle,
  type Trace,
} from '@ghostapi/core';
import { chmod } from 'node:fs/promises';
import { appendNdjson, readJsonIfExists, readNdjson, writeJsonAtomic } from './json-file.js';
import { storePaths, targetPaths, STORE_DIR_NAME, type StorePaths } from './paths.js';

/**
 * Session material for one target.
 *
 * This is the only file in the store that holds a live credential, it is
 * written 0600, it is gitignored, and it is excluded from every export path by
 * construction — `exportBundle` reads operations and the target, never this.
 */
export const storedAuthSchema = z
  .object({
    origin: z.string(),
    updatedAt: z.number(),
    cookies: z.array(
      z.object({
        name: z.string(),
        value: z.string(),
        domain: z.string(),
        path: z.string(),
        expires: z.number(),
        httpOnly: z.boolean(),
        secure: z.boolean(),
      }),
    ),
  })
  .strict();
export type StoredAuth = z.infer<typeof storedAuthSchema>;

const traceSchema = z
  .object({
    id: z.string(),
    startedAt: z.number(),
    labels: z.record(z.string()).default({}),
    spans: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        startedAt: z.number(),
        durationMs: z.number(),
        status: z.enum(['ok', 'error']),
        data: z.record(z.unknown()).default({}),
      }),
    ),
  })
  .strict();

async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => join(dir, entry.name))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * File-backed store.
 *
 * Plain JSON and NDJSON on purpose. SQLite would win on ad-hoc queries, but the
 * MVP's queries are "read every observation of one session" and "list the
 * operations", both of which a directory does fine — and a directory is
 * diffable, greppable, trivially inspectable and has no native dependency.
 * The interface below is the seam to swap in SQLite if correlation ever needs it.
 */
export class GhostStore {
  readonly paths: StorePaths;

  private constructor(paths: StorePaths) {
    this.paths = paths;
  }

  static at(root: string): GhostStore {
    return new GhostStore(storePaths(resolve(root)));
  }

  /** Resolves `.ghostapi` from a working directory, honouring GHOSTAPI_HOME. */
  static resolve(cwd: string = process.cwd()): GhostStore {
    const override = process.env.GHOSTAPI_HOME;
    return GhostStore.at(override ? resolve(override) : join(resolve(cwd), STORE_DIR_NAME));
  }

  async init(): Promise<GhostConfig> {
    await mkdir(this.paths.targetsDir, { recursive: true });
    const existing = await this.readConfig();
    if (existing) return existing;
    await writeJsonAtomic(this.paths.configFile, DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }

  async readConfig(): Promise<GhostConfig | undefined> {
    return readJsonIfExists(this.paths.configFile, configSchema);
  }

  async config(): Promise<GhostConfig> {
    return (await this.readConfig()) ?? DEFAULT_CONFIG;
  }

  async writeConfig(config: GhostConfig): Promise<void> {
    await writeJsonAtomic(this.paths.configFile, config);
  }

  async patchConfig(patch: Partial<GhostConfig>): Promise<GhostConfig> {
    const next = { ...(await this.config()), ...patch };
    await this.writeConfig(next);
    return next;
  }

  // ---- targets -------------------------------------------------------------

  async createTarget(input: { name?: string; url: string }): Promise<Target> {
    const url = new URL(input.url);
    const slug = slugify(input.name ?? url.host);
    const now = Date.now();
    const existing = await this.readTarget(slug);
    if (existing) {
      const updated: Target = { ...existing, startUrl: input.url, updatedAt: now };
      await writeJsonAtomic(targetPaths(this.paths, slug).targetFile, updated);
      return updated;
    }
    const target = targetSchema.parse({
      slug,
      name: input.name ?? url.host,
      origin: url.origin,
      startUrl: input.url,
      description: '',
      createdAt: now,
      updatedAt: now,
    });
    const tp = targetPaths(this.paths, slug);
    await mkdir(tp.operationsDir, { recursive: true });
    await mkdir(tp.observationsDir, { recursive: true });
    await mkdir(tp.sessionsDir, { recursive: true });
    await writeJsonAtomic(tp.targetFile, target);
    const config = await this.config();
    if (!config.defaultTarget) await this.patchConfig({ defaultTarget: slug });
    return target;
  }

  async readTarget(slug: string): Promise<Target | undefined> {
    return readJsonIfExists(targetPaths(this.paths, slug).targetFile, targetSchema);
  }

  async requireTarget(slug?: string): Promise<Target> {
    const resolved = slug ?? (await this.config()).defaultTarget;
    if (!resolved) {
      throw new GhostError({
        code: ErrorCodes.TargetNotFound,
        title: 'No target selected',
        detail: 'This workspace has no default target.',
        remedy: 'Run `ghostapi open <url>` to create one.',
      });
    }
    const target = await this.readTarget(resolved);
    if (!target) {
      throw new GhostError({
        code: ErrorCodes.TargetNotFound,
        title: 'Target not found',
        detail: `No target named "${resolved}" exists in ${this.paths.root}.`,
        remedy: 'Run `ghostapi targets` to list known targets.',
      });
    }
    return target;
  }

  async listTargets(): Promise<Target[]> {
    let entries: string[];
    try {
      entries = (await readdir(this.paths.targetsDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const targets: (Target | undefined)[] = await Promise.all(
      entries.map((slug) => this.readTarget(slug)),
    );
    return targets.filter((target): target is Target => target !== undefined);
  }

  async saveTarget(target: Target): Promise<void> {
    await writeJsonAtomic(targetPaths(this.paths, target.slug).targetFile, {
      ...target,
      updatedAt: Date.now(),
    });
  }

  async writeAuth(slug: string, auth: StoredAuth): Promise<void> {
    const file = targetPaths(this.paths, slug).authFile;
    await writeJsonAtomic(file, storedAuthSchema.parse(auth));
    await chmod(file, 0o600).catch(() => undefined);
  }

  async readAuth(slug: string): Promise<StoredAuth | undefined> {
    return readJsonIfExists(targetPaths(this.paths, slug).authFile, storedAuthSchema);
  }

  async clearAuth(slug: string): Promise<void> {
    await rm(targetPaths(this.paths, slug).authFile, { force: true });
  }

  targetProfileDir(slug: string): string {
    return targetPaths(this.paths, slug).profileDir;
  }

  // ---- sessions & observations --------------------------------------------

  async saveSession(session: Session): Promise<void> {
    await writeJsonAtomic(
      join(targetPaths(this.paths, session.targetSlug).sessionsDir, `${session.id}.json`),
      session,
    );
  }

  async listSessions(slug: string): Promise<Session[]> {
    const files = await listJsonFiles(targetPaths(this.paths, slug).sessionsDir);
    const sessions = await Promise.all(files.map((file) => readJsonIfExists(file, sessionSchema)));
    return sessions
      .filter((session): session is Session => session !== undefined)
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  async appendObservations(
    slug: string,
    sessionId: string,
    records: readonly Observation[],
  ): Promise<void> {
    await appendNdjson(
      join(targetPaths(this.paths, slug).observationsDir, `${sessionId}.ndjson`),
      records,
    );
  }

  async readSessionObservations(slug: string, sessionId: string): Promise<Observation[]> {
    return readNdjson(
      join(targetPaths(this.paths, slug).observationsDir, `${sessionId}.ndjson`),
      observationSchema,
    );
  }

  async readAllObservations(slug: string): Promise<Observation[]> {
    const dir = targetPaths(this.paths, slug).observationsDir;
    let files: string[];
    try {
      files = (await readdir(dir)).filter((name) => name.endsWith('.ndjson')).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const batches = await Promise.all(
      files.map((name) => readNdjson(join(dir, name), observationSchema)),
    );
    return batches.flat();
  }

  // ---- operations ----------------------------------------------------------

  async saveOperation(slug: string, operation: Operation): Promise<void> {
    await writeJsonAtomic(
      join(targetPaths(this.paths, slug).operationsDir, `${operation.name}.json`),
      operation,
    );
  }

  async readOperation(slug: string, name: string): Promise<Operation | undefined> {
    return readJsonIfExists(
      join(targetPaths(this.paths, slug).operationsDir, `${name}.json`),
      operationSchema,
    );
  }

  async requireOperation(slug: string, name: string): Promise<Operation> {
    const operation = await this.readOperation(slug, name);
    if (operation) return operation;
    const known = (await this.listOperations(slug)).map((item) => item.name);
    throw new GhostError({
      code: ErrorCodes.OperationNotFound,
      title: 'Operation not found',
      detail: `"${name}" is not a known operation for target ${slug}.`,
      remedy:
        known.length > 0
          ? `Known operations: ${known.join(', ')}. Run \`ghostapi operations\` for details.`
          : 'Run `ghostapi observe` to discover operations first.',
      context: { known },
    });
  }

  async listOperations(slug: string): Promise<Operation[]> {
    const files = await listJsonFiles(targetPaths(this.paths, slug).operationsDir);
    const operations = await Promise.all(
      files.map((file) => readJsonIfExists(file, operationSchema)),
    );
    return operations
      .filter((operation): operation is Operation => operation !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async deleteOperation(slug: string, name: string): Promise<void> {
    await rm(join(targetPaths(this.paths, slug).operationsDir, `${name}.json`), { force: true });
  }

  // ---- traces --------------------------------------------------------------

  async saveTrace(slug: string, trace: Trace): Promise<void> {
    await writeJsonAtomic(join(targetPaths(this.paths, slug).tracesDir, `${trace.id}.json`), trace);
  }

  async listTraces(slug: string, limit = 20): Promise<Trace[]> {
    const files = await listJsonFiles(targetPaths(this.paths, slug).tracesDir);
    const recent = files.slice(-limit).reverse();
    const traces = await Promise.all(recent.map((file) => readJsonIfExists(file, traceSchema)));
    return traces.filter((trace): trace is Trace => trace !== undefined);
  }

  // ---- portability ---------------------------------------------------------

  async exportBundle(slug: string, generator: string): Promise<TargetBundle> {
    const target = await this.requireTarget(slug);
    const operations = await this.listOperations(slug);
    return targetBundleSchema.parse({
      format: TARGET_BUNDLE_FORMAT,
      generator,
      exportedAt: Date.now(),
      target,
      operations,
    });
  }

  async importBundle(bundle: TargetBundle): Promise<{ slug: string; operations: number }> {
    const parsed = targetBundleSchema.parse(bundle);
    const tp = targetPaths(this.paths, parsed.target.slug);
    await mkdir(tp.operationsDir, { recursive: true });
    await writeJsonAtomic(tp.targetFile, { ...parsed.target, updatedAt: Date.now() });
    for (const operation of parsed.operations) {
      await this.saveOperation(parsed.target.slug, operation);
    }
    const config = await this.config();
    if (!config.defaultTarget) await this.patchConfig({ defaultTarget: parsed.target.slug });
    return { slug: parsed.target.slug, operations: parsed.operations.length };
  }
}
