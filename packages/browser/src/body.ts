import type { BodyKind, GraphqlEnvelope } from '@ghostapi/core';

const JSON_TYPES = ['application/json', '+json', 'application/graphql'];

export function bodyKindFor(contentType: string | undefined, raw: string | undefined): BodyKind {
  if (raw === undefined || raw.length === 0) return 'none';
  const type = (contentType ?? '').toLowerCase();
  if (JSON_TYPES.some((candidate) => type.includes(candidate))) return 'json';
  if (type.includes('application/x-www-form-urlencoded')) return 'form';
  if (type.includes('multipart/form-data')) return 'multipart';
  if (type.startsWith('text/') || type.includes('xml')) return 'text';
  if (type.length === 0) {
    const trimmed = raw.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
    return 'text';
  }
  return 'binary';
}

export interface ParsedBody {
  kind: BodyKind;
  value: unknown;
}

const MAX_TEXT_BODY = 64 * 1024;

export function parseBody(kind: BodyKind, raw: string | undefined): ParsedBody {
  if (raw === undefined || kind === 'none') return { kind: 'none', value: undefined };
  if (kind === 'json') {
    try {
      return { kind: 'json', value: JSON.parse(raw) };
    } catch {
      return { kind: 'text', value: raw.slice(0, MAX_TEXT_BODY) };
    }
  }
  if (kind === 'form') {
    return { kind: 'form', value: Object.fromEntries(new URLSearchParams(raw)) };
  }
  if (kind === 'binary' || kind === 'multipart') {
    return { kind, value: `<${raw.length} bytes>` };
  }
  return { kind: 'text', value: raw.slice(0, MAX_TEXT_BODY) };
}

/**
 * Recognises a GraphQL request from its envelope rather than its URL, because
 * plenty of apps serve GraphQL from paths that are not named /graphql.
 */
export function detectGraphql(body: unknown): GraphqlEnvelope | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  const record = body as Record<string, unknown>;
  const query = record.query;
  if (typeof query !== 'string' || query.length === 0) return undefined;
  if (!/\b(query|mutation|subscription|fragment)\b|^\s*\{/.test(query)) return undefined;
  const match = /^\s*(query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)?/.exec(query);
  const inlineName = typeof record.operationName === 'string' ? record.operationName : undefined;
  const envelope: GraphqlEnvelope = {
    query,
    operationName: inlineName ?? match?.[2],
    operationType: (match?.[1] as GraphqlEnvelope['operationType']) ?? 'query',
    variables: record.variables,
  };
  return envelope;
}

const STATIC_EXTENSIONS = [
  '.js',
  '.mjs',
  '.css',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.avif',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.map',
  '.mp4',
  '.webm',
  '.wasm',
];

export function looksStatic(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return STATIC_EXTENSIONS.some((extension) => lower.endsWith(extension));
}
