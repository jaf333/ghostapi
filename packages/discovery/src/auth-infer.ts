import { SENSITIVE_HEADERS, type AuthStrategy, type NetworkObservation } from '@ghostapi/core';

function envNameFor(slug: string): string {
  const normalized = slug
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
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
  /**
   * Credential headers seen anywhere on the same origin. Authentication is a
   * property of the application, not of one request: Chrome reports network
   * headers on a side channel and occasionally that record is missed, so a
   * single observation without a Cookie header is weak evidence of a public
   * endpoint, while the origin as a whole is strong evidence.
   */
  originHeaderNames: readonly string[] = [],
): AuthStrategy {
  const headerNames = new Set([
    ...observations.flatMap((observation) => observation.sensitiveRequestHeaders),
    ...originHeaderNames,
  ]);
  if (headerNames.has('authorization')) {
    return {
      strategy: 'header',
      header: 'authorization',
      env: envNameFor(targetSlug),
      prefix: 'Bearer ',
    };
  }
  // Every header the capture layer treats as a credential is a header this can
  // authenticate with. A hand-maintained subset here would silently produce an
  // operation with `strategy: "none"` that can only ever return 401.
  const cookieHeaders = new Set(['cookie', 'set-cookie']);
  for (const custom of SENSITIVE_HEADERS) {
    if (custom === 'authorization' || cookieHeaders.has(custom)) continue;
    if (headerNames.has(custom)) {
      return { strategy: 'header', header: custom, env: envNameFor(targetSlug) };
    }
  }
  if (headerNames.has('cookie')) {
    return { strategy: 'browser-session', cookieNames: [] };
  }
  return { strategy: 'none' };
}
