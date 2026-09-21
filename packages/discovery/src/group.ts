import { looksLikeIdentifier } from './path-template.js';
import type { NetworkObservation } from '@ghostapi/core';

/** Masks id-shaped segments so two calls to the same route land in one group. */
export function pathSkeleton(path: string): string {
  return `/${path
    .split('/')
    .filter((part) => part.length > 0)
    .map((part) => (looksLikeIdentifier(part) ? '*' : part))
    .join('/')}`;
}

export function groupKeyOf(observation: NetworkObservation): string {
  if (observation.graphql) {
    const name = observation.graphql.operationName ?? 'anonymous';
    return `graphql ${observation.origin}${observation.path} ${name}`;
  }
  return `${observation.method} ${observation.origin}${pathSkeleton(observation.path)}`;
}

export function groupObservations(
  observations: readonly NetworkObservation[],
): Map<string, NetworkObservation[]> {
  const groups = new Map<string, NetworkObservation[]>();
  for (const observation of observations) {
    const key = groupKeyOf(observation);
    const bucket = groups.get(key);
    if (bucket) bucket.push(observation);
    else groups.set(key, [observation]);
  }
  return groups;
}

/**
 * Keeps traffic that plausibly carries an operation.
 *
 * Structured payloads in either direction are the signal. Everything else —
 * HTML documents, pings, opaque blobs — is noise for this purpose, and calling
 * it an operation would mean shipping a tool an agent cannot use.
 */
export function isApiLike(observation: NetworkObservation): boolean {
  if (observation.graphql) return true;
  if (observation.resourceType === 'Document') return false;
  // An XHR or fetch is the application talking to its own backend. That is the
  // definition of the surface GhostAPI is after, and it holds even for a 204
  // with no body at all — which is exactly what a delete usually returns.
  if (observation.resourceType === 'XHR' || observation.resourceType === 'Fetch') return true;
  const structuredRequest = ['json', 'form'].includes(observation.requestBodyKind);
  const structuredResponse = observation.responseBodyKind === 'json';
  return structuredRequest || structuredResponse;
}

export function isSuccess(observation: NetworkObservation): boolean {
  return observation.status !== undefined && observation.status >= 200 && observation.status < 300;
}
