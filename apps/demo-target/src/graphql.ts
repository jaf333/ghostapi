import { randomUUID } from 'node:crypto';
import type { Database } from './data.js';

/**
 * A deliberately tiny GraphQL endpoint. It exists so GhostAPI's GraphQL
 * detection is exercised against a real POST /graphql envelope rather than
 * asserted in a README.
 */
export interface GraphqlRequest {
  query?: unknown;
  variables?: unknown;
  operationName?: unknown;
}

export interface GraphqlResult {
  status: number;
  body: unknown;
}

export function handleGraphql(db: Database, payload: GraphqlRequest): GraphqlResult {
  const query = typeof payload.query === 'string' ? payload.query : '';
  const variables =
    typeof payload.variables === 'object' && payload.variables !== null
      ? (payload.variables as Record<string, unknown>)
      : {};

  if (query.length === 0) {
    return { status: 400, body: { errors: [{ message: 'query is required' }] } };
  }

  if (/\bprojects\b/.test(query) && !/^\s*mutation/.test(query)) {
    return { status: 200, body: { data: { projects: db.projects } } };
  }

  if (/createTag/.test(query)) {
    const name = typeof variables.name === 'string' ? variables.name.trim() : '';
    if (name.length === 0) {
      return { status: 200, body: { errors: [{ message: 'name is required' }] } };
    }
    const tag = { id: `tag_${randomUUID().slice(0, 8)}`, name };
    db.tags.push(tag);
    return { status: 200, body: { data: { createTag: tag } } };
  }

  if (/\btags\b/.test(query)) {
    return { status: 200, body: { data: { tags: db.tags } } };
  }

  return { status: 200, body: { errors: [{ message: 'Unknown operation' }] } };
}
