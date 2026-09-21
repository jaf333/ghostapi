'use server';

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { revalidatePath } from 'next/cache';
import { assertSafeUrl, isGhostError } from '@ghostapi/core';
import { executeOperation } from '@ghostapi/executor';
import { store } from '@/lib/store';

export interface RunState {
  readonly status: 'idle' | 'ok' | 'error';
  readonly message?: string;
  readonly body?: string;
  readonly latencyMs?: number;
  readonly transport?: string;
  readonly traceId?: string;
}

/**
 * Runs one operation from the inspector.
 *
 * Destructive operations are refused here regardless of what the form sends:
 * a confirmation that lives only in the browser is not a confirmation.
 */
export async function runOperation(
  slug: string,
  name: string,
  _previous: RunState,
  formData: FormData,
): Promise<RunState> {
  const raw = String(formData.get('input') ?? '{}');
  let inputs: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw.trim().length === 0 ? '{}' : raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { status: 'error', message: 'Inputs must be a JSON object.' };
    }
    inputs = parsed as Record<string, unknown>;
  } catch (error) {
    return { status: 'error', message: `Invalid JSON: ${(error as Error).message}` };
  }

  const ghost = store();
  try {
    const target = await ghost.requireTarget(slug);
    const operation = await ghost.requireOperation(slug, name);
    if (operation.destructive) {
      return {
        status: 'error',
        message:
          'This operation is marked destructive. Run it from the CLI with --yes, where the confirmation is explicit.',
      };
    }
    const auth = await ghost.readAuth(target.slug);
    const result = await executeOperation({
      operation,
      inputs,
      auth: { cookies: auth?.cookies ?? [] },
    });
    await ghost.saveTrace(slug, result.trace);
    revalidatePath(`/t/${slug}`);
    return {
      status: 'ok',
      body: JSON.stringify(result.data, null, 2),
      latencyMs: result.latencyMs,
      transport: result.transport,
      traceId: result.trace.id,
    };
  } catch (error) {
    if (isGhostError(error)) {
      return {
        status: 'error',
        message: `${error.title}: ${error.detail}${error.remedy ? `\n\n${error.remedy}` : ''}`,
      };
    }
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

export interface DiscoveryState {
  readonly status: 'idle' | 'started' | 'error';
  readonly message?: string;
  readonly slug?: string;
}

/**
 * Starts a real discovery session.
 *
 * The browser has to run on this machine, so the inspector shells out to the
 * same CLI a person would type. It is spawned detached and its output is
 * discarded: the evidence lands in the store, which is what this page reads.
 */
export async function startDiscovery(
  _previous: DiscoveryState,
  formData: FormData,
): Promise<DiscoveryState> {
  const url = String(formData.get('url') ?? '').trim();
  if (url.length === 0) return { status: 'error', message: 'Enter a URL.' };

  try {
    assertSafeUrl(url);
  } catch (error) {
    return {
      status: 'error',
      message: isGhostError(error)
        ? `${error.title}: ${error.detail}`
        : 'That is not a usable URL.',
    };
  }

  const cli = fileURLToPath(new URL('../../../packages/cli/dist/bin.js', import.meta.url));
  if (!existsSync(cli)) {
    return {
      status: 'error',
      message: 'The GhostAPI CLI is not built. Run `pnpm build` in the repository root.',
    };
  }

  const ghost = store();
  const child = spawn(process.execPath, [cli, 'open', url, '--quiet'], {
    cwd: process.env.GHOSTAPI_CWD ?? process.cwd(),
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, NO_COLOR: '1' },
  });
  child.unref();

  const target = await ghost.createTarget({ url });
  revalidatePath('/');
  return {
    status: 'started',
    slug: target.slug,
    message:
      'A browser window is opening. Sign in if you need to, use the application, then close the window — GhostAPI derives the operations when it closes.',
  };
}
