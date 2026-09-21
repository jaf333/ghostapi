import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { ErrorCodes, GhostError, isReadOnly, type Operation } from '@ghostapi/core';

export const evalExpectationSchema = z
  .object({
    status: z.enum(['success', 'error']).default('success'),
    /** Dotted paths into the response that must equal the given value. */
    properties: z.record(z.unknown()).default({}),
    /** Dotted paths that must simply be present. */
    present: z.array(z.string()).default([]),
    /** Substring the error message must contain, for error cases. */
    errorContains: z.string().optional(),
  })
  .strict();
export type EvalExpectation = z.infer<typeof evalExpectationSchema>;

export const evalCaseSchema = z
  .object({
    name: z.string(),
    input: z.record(z.unknown()).default({}),
    expect: evalExpectationSchema.default({ status: 'success', properties: {}, present: [] }),
    skip: z.string().optional(),
  })
  .strict();
export type EvalCase = z.infer<typeof evalCaseSchema>;

export const evalSuiteSchema = z
  .object({
    operation: z.string(),
    /** Destructive operations do not run unless the author opts in explicitly. */
    allowDestructive: z.boolean().default(false),
    cases: z.array(evalCaseSchema),
  })
  .strict();
export type EvalSuite = z.infer<typeof evalSuiteSchema>;

export async function readSuites(dir: string): Promise<EvalSuite[]> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => /\.(ya?ml|json)$/.test(name)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const suites: EvalSuite[] = [];
  for (const name of names) {
    const raw = await readFile(join(dir, name), 'utf8');
    const parsed = name.endsWith('.json') ? JSON.parse(raw) : parse(raw);
    const result = evalSuiteSchema.safeParse(parsed);
    if (!result.success) {
      throw new GhostError({
        code: ErrorCodes.StoreCorrupt,
        title: 'Invalid eval suite',
        detail: `${name}: ${result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`,
        remedy: 'Fix the file, or delete it and re-run `ghostapi eval --generate`.',
      });
    }
    suites.push(result.data);
  }
  return suites;
}

/**
 * Generates a starting suite from what was actually observed.
 *
 * Read-only operations get a real smoke case. Anything that writes gets a case
 * that is written but skipped by default, because running a generated mutation
 * against someone's live application is not a reasonable default.
 */
export function generateSuite(operation: Operation): EvalSuite {
  const properties = operation.inputs.properties ?? {};
  const required = operation.inputs.required ?? [];
  const input: Record<string, unknown> = {};
  for (const key of required) {
    const schema = properties[key];
    const example = schema?.examples?.[0] ?? schema?.enum?.[0];
    if (example !== undefined) input[key] = example;
    else if (schema?.type === 'number' || schema?.type === 'integer') input[key] = 1;
    else if (schema?.type === 'boolean') input[key] = false;
    else input[key] = `ghostapi-eval-${operation.name}`;
  }

  const readOnly = isReadOnly(operation);
  const cases: EvalCase[] = [
    {
      name: `${operation.name} responds successfully`,
      input,
      expect: { status: 'success', properties: {}, present: [] },
      ...(readOnly
        ? {}
        : {
            skip: operation.destructive
              ? 'destructive: run only against a disposable environment'
              : 'writes data: review the input, then remove this skip',
          }),
    },
  ];

  if (required.length > 0 && !operation.destructive) {
    cases.push({
      name: `${operation.name} rejects missing ${required[0]}`,
      input: Object.fromEntries(Object.entries(input).filter(([key]) => key !== required[0])),
      expect: { status: 'error', properties: {}, present: [] },
    });
  }

  return { operation: operation.name, allowDestructive: false, cases };
}

export async function writeSuite(dir: string, suite: EvalSuite): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${suite.operation}.yaml`);
  await writeFile(file, stringify(suite), 'utf8');
  return file;
}
