import { ErrorCodes, GhostError, type ValueBinding } from '@ghostapi/core';

/**
 * Evaluates a binding tree against caller inputs.
 *
 * Bindings are data, so this is a walk, not an interpreter: there is no string
 * templating, no expression syntax and nothing that could turn a value from an
 * untrusted page into executable behaviour.
 */
export function resolveBinding(binding: ValueBinding, inputs: Record<string, unknown>): unknown {
  switch (binding.kind) {
    case 'literal':
      return binding.value;
    case 'input':
      return inputs[binding.field];
    case 'array':
      return binding.items.map((item) => resolveBinding(item, inputs));
    case 'object': {
      const output: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(binding.properties)) {
        const value = resolveBinding(child, inputs);
        // An absent optional input must not become an explicit null on the wire.
        if (value !== undefined) output[key] = value;
      }
      return output;
    }
  }
}

export function fillUrlTemplate(
  template: string,
  params: readonly string[],
  inputs: Record<string, unknown>,
): string {
  let url = template;
  for (const param of params) {
    const value = inputs[param];
    if (value === undefined || value === null || value === '') {
      throw new GhostError({
        code: ErrorCodes.InvalidInput,
        title: 'Missing path parameter',
        detail: `The operation's URL needs "${param}", which was not provided.`,
        remedy: `Pass {"${param}": "…"} in the operation input.`,
      });
    }
    url = url.split(`{${param}}`).join(encodeURIComponent(String(value)));
  }
  const leftover = /\{([^}]+)\}/.exec(url);
  if (leftover) {
    throw new GhostError({
      code: ErrorCodes.InvalidInput,
      title: 'Unresolved URL placeholder',
      detail: `The URL still contains {${leftover[1]}} after binding inputs.`,
      remedy: 'Re-run discovery for this operation; its path template is stale.',
    });
  }
  return url;
}
