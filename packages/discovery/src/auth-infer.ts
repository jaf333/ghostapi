import type { AuthStrategy, NetworkObservation } from '@ghostapi/core';

function envNameFor(slug: string): string {
  const normalized = slug.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `GHOSTAPI_${normalized || 'TARGET'}_TOKEN`;
}

/**
 * Infers how a target authenticates from the *names* of the credential headers
 * that were present — never from their values, which the capture layer already
 * discarded.
 *
 * The result is a reference, not a secret: either "reuse the browser session
 * the user signed into" or "read this environment variable at run time".
 */
export function inferAuth(
  observations: readonly NetworkObservation[],
  targetSlug: string,
): AuthStrategy {
  const headerNames = new Set(
    observations.flatMap((observation) => observation.sensitiveRequestHeaders),
  );
  if (headerNames.has('authorization')) {
    return { strategy: 'header', header: 'authorization', env: envNameFor(targetSlug), prefix: 'Bearer ' };
  }
  for (const custom of ['x-api-key', 'x-auth-token', 'x-access-token', 'api-key']) {
    if (headerNames.has(custom)) {
      return { strategy: 'header', header: custom, env: envNameFor(targetSlug) };
    }
  }
  if (headerNames.has('cookie')) {
    return { strategy: 'browser-session', cookieNames: [] };
  }
  return { strategy: 'none' };
}
