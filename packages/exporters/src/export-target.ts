import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  assertSafeUrl,
  defaultRedactor,
  ErrorCodes,
  GhostError,
  IMPORTED_URL_POLICY,
  REDACTED,
  targetBundleSchema,
  type TargetBundle,
  type UrlPolicy,
} from '@ghostapi/core';

export async function writeTargetBundle(file: string, bundle: TargetBundle): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(targetBundleSchema.parse(bundle), null, 2)}\n`, 'utf8');
}

export interface ImportAudit {
  readonly bundle: TargetBundle;
  readonly warnings: string[];
}

/**
 * Reads a target bundle from disk and treats it as untrusted.
 *
 * A `.ghost` file is exactly the kind of thing people will pass around, so it
 * gets the full treatment: schema validation, URL policy that blocks private
 * and metadata addresses by default, and a refusal for anything carrying
 * credential-shaped material.
 */
export async function readTargetBundle(
  file: string,
  policy: UrlPolicy = IMPORTED_URL_POLICY,
): Promise<ImportAudit> {
  const raw = await readFile(file, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new GhostError(
      {
        code: ErrorCodes.StoreCorrupt,
        title: 'Invalid target file',
        detail: `${file} is not valid JSON.`,
        remedy: 'Re-export it with `ghostapi export target`.',
      },
      { cause: error },
    );
  }

  const result = targetBundleSchema.safeParse(parsed);
  if (!result.success) {
    throw new GhostError({
      code: ErrorCodes.StoreCorrupt,
      title: 'Unsupported target file',
      detail: result.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.')} ${issue.message}`)
        .join('; '),
      remedy: 'This file was produced by a different GhostAPI version.',
    });
  }

  const bundle = result.data;
  const warnings: string[] = [];

  assertSafeUrl(bundle.target.startUrl, policy);
  for (const operation of bundle.operations) {
    if (operation.transport.type === 'http') {
      assertSafeUrl(operation.transport.urlTemplate.replace(/\{[^}]+\}/g, 'x'), policy);
    }
    if (operation.transport.type === 'graphql') {
      assertSafeUrl(operation.transport.endpoint, policy);
    }
    if (operation.destructive) {
      warnings.push(`${operation.name} is destructive and will require --yes to run.`);
    }
  }

  // Inspect every header literal the bundle would replay, not a fixed list of
  // three names: the interesting case is a vendor header nobody enumerated.
  for (const operation of bundle.operations) {
    const transports = [operation.transport, ...operation.fallbacks];
    for (const transport of transports) {
      if (transport.type !== 'http' && transport.type !== 'graphql') continue;
      for (const [name, binding] of Object.entries(transport.headers ?? {})) {
        if (binding.kind !== 'literal') continue;
        const looksSensitive =
          defaultRedactor.isSensitiveHeader(name) ||
          defaultRedactor.isSensitiveKey(name) ||
          defaultRedactor.matchSensitiveValue(binding.value) !== undefined;
        if (!looksSensitive || binding.value === REDACTED) continue;
        throw new GhostError({
          code: ErrorCodes.UnsafeTarget,
          title: 'Target file contains credential material',
          detail: `Operation "${operation.name}" would replay a literal ${name} header.`,
          remedy:
            'Refusing to import. Ask whoever produced it to re-export with a current GhostAPI, which references credentials instead of embedding them.',
        });
      }
    }
  }

  return { bundle, warnings };
}
