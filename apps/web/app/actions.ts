'use server';

import { revalidatePath } from 'next/cache';
import { isGhostError } from '@ghostapi/core';
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
