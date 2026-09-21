import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { z } from 'zod';
import { ErrorCodes, GhostError } from '@ghostapi/core';

/** Atomic write: a half-written operation file is worse than no file at all. */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = join(dirname(file), `.${randomBytes(6).toString('hex')}.tmp`);
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, file);
}

export async function readJsonIfExists<S extends z.ZodTypeAny>(
  file: string,
  schema: S,
): Promise<z.output<S> | undefined> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new GhostError(
      {
        code: ErrorCodes.StoreCorrupt,
        title: 'Corrupt store file',
        detail: `${file} is not valid JSON.`,
        remedy: 'Delete the file and re-run discovery, or restore it from version control.',
      },
      { cause: error },
    );
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new GhostError({
      code: ErrorCodes.StoreCorrupt,
      title: 'Unexpected store file shape',
      detail: `${file} does not match the expected schema: ${result.error.issues
        .slice(0, 3)
        .map((issue: z.ZodIssue) => `${issue.path.join('.')} ${issue.message}`)
        .join('; ')}`,
      remedy: 'This file was written by an incompatible GhostAPI version. Re-run discovery.',
    });
  }
  return result.data;
}

export async function appendNdjson(file: string, records: readonly unknown[]): Promise<void> {
  if (records.length === 0) return;
  await mkdir(dirname(file), { recursive: true });
  const payload = records.map((record) => `${JSON.stringify(record)}\n`).join('');
  await writeFile(file, payload, { encoding: 'utf8', flag: 'a' });
}

export async function readNdjson<S extends z.ZodTypeAny>(
  file: string,
  schema: S,
): Promise<z.output<S>[]> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const out: z.output<S>[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    // A single malformed line — a half-written record after a crash, a record
    // from an older schema — must not cost the whole capture session.
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const parsed = schema.safeParse(value);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}
