import type { HttpMethod, OperationVerb } from '@ghostapi/core';
import { singular, type PathTemplate } from './path-template.js';

const SEARCH_PARAM_NAMES = ['q', 'query', 'search', 'term', 'filter', 'keyword'];
const AUTH_ENTITIES = [
  'session',
  'login',
  'logout',
  'signin',
  'signout',
  'signup',
  'auth',
  'token',
];

function pascal(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function camel(value: string): string {
  const source = pascal(value);
  return source.charAt(0).toLowerCase() + source.slice(1);
}

function plural(word: string): string {
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  return `${word}s`;
}

export type EndpointShape = 'collection' | 'item' | 'action' | 'root';

export interface EndpointAnatomy {
  readonly shape: EndpointShape;
  /** Singular entity name in lowerCamelCase, e.g. "todo". */
  readonly entity: string;
  /** Action segment for action-shaped endpoints, e.g. "archive". */
  readonly action?: string;
}

const isParam = (segment: string): boolean => segment.startsWith('{') && segment.endsWith('}');

/**
 * Reads the *shape* of a REST-ish path without knowing anything about the app.
 *
 * `/api/todos` is a collection, `/api/todos/{todoId}` is an item and
 * `/api/todos/{todoId}/archive` is an action on an item. That distinction is
 * what turns `POST /api/todos` into `createTodo` instead of `postApiTodos`.
 */
export function analyzeEndpoint(template: PathTemplate): EndpointAnatomy {
  const segments = template.segments.filter((segment) => segment.length > 0);
  const meaningful = segments.filter(
    (segment) => !['api', 'v1', 'v2', 'v3', 'rest'].includes(segment),
  );
  if (meaningful.length === 0) return { shape: 'root', entity: 'resource' };

  const last = meaningful[meaningful.length - 1] as string;
  const previous = meaningful[meaningful.length - 2];

  if (isParam(last)) {
    const collection = previous && !isParam(previous) ? previous : 'resource';
    return { shape: 'item', entity: camel(singular(collection)) };
  }

  if (previous !== undefined && isParam(previous)) {
    const collection = meaningful[meaningful.length - 3];
    return {
      shape: 'action',
      entity: camel(singular(collection && !isParam(collection) ? collection : 'resource')),
      action: camel(last),
    };
  }

  return { shape: 'collection', entity: camel(singular(last)) };
}

export interface NameInput {
  readonly method: HttpMethod;
  readonly anatomy: EndpointAnatomy;
  readonly queryKeys: readonly string[];
  readonly hasRequestBody: boolean;
}

export interface OperationName {
  readonly name: string;
  readonly verb: OperationVerb;
  readonly entity: string;
}

/**
 * Derives a semantic operation name from an endpoint's shape and method.
 * Generic by construction: no target, vendor or product name appears anywhere
 * in these rules.
 */
export function nameOperation(input: NameInput): OperationName {
  const { anatomy, method } = input;
  const entity = anatomy.entity;
  const Entity = pascal(entity);

  if (AUTH_ENTITIES.includes(entity.toLowerCase())) {
    if (method === 'POST' || method === 'PUT') {
      return { name: 'signIn', verb: 'auth', entity };
    }
    if (method === 'DELETE') return { name: 'signOut', verb: 'auth', entity };
    if (method === 'GET') return { name: `get${Entity}`, verb: 'read', entity };
  }

  if (anatomy.shape === 'action' && anatomy.action) {
    const action = anatomy.action;
    const verb: OperationVerb =
      action === 'archive'
        ? 'archive'
        : action === 'restore' || action === 'unarchive'
          ? 'restore'
          : action === 'search'
            ? 'search'
            : 'custom';
    return { name: `${camel(action)}${Entity}`, verb, entity };
  }

  if (anatomy.shape === 'item') {
    switch (method) {
      case 'GET':
        return { name: `get${Entity}`, verb: 'read', entity };
      case 'PATCH':
      case 'PUT':
        return { name: `update${Entity}`, verb: 'update', entity };
      case 'DELETE':
        return { name: `delete${Entity}`, verb: 'delete', entity };
      case 'POST':
        return { name: `update${Entity}`, verb: 'update', entity };
      default:
        return { name: `${camel(method)}${Entity}`, verb: 'custom', entity };
    }
  }

  switch (method) {
    case 'POST':
      return { name: `create${Entity}`, verb: 'create', entity };
    case 'GET': {
      const searching = input.queryKeys.some((key) =>
        SEARCH_PARAM_NAMES.includes(key.toLowerCase()),
      );
      return searching
        ? { name: `search${pascal(plural(entity))}`, verb: 'search', entity }
        : { name: `list${pascal(plural(entity))}`, verb: 'list', entity };
    }
    case 'PUT':
    case 'PATCH':
      return { name: `update${Entity}`, verb: 'update', entity };
    case 'DELETE':
      return { name: `delete${Entity}`, verb: 'delete', entity };
    default:
      return { name: `${camel(method)}${pascal(plural(entity))}`, verb: 'custom', entity };
  }
}

const GRAPHQL_VERB_PREFIXES: readonly { prefix: string; verb: OperationVerb }[] = [
  { prefix: 'create', verb: 'create' },
  { prefix: 'add', verb: 'create' },
  { prefix: 'update', verb: 'update' },
  { prefix: 'edit', verb: 'update' },
  { prefix: 'delete', verb: 'delete' },
  { prefix: 'remove', verb: 'delete' },
  { prefix: 'archive', verb: 'archive' },
  { prefix: 'search', verb: 'search' },
  { prefix: 'list', verb: 'list' },
  { prefix: 'get', verb: 'read' },
];

export function nameGraphqlOperation(
  operationName: string | undefined,
  operationType: 'query' | 'mutation',
  fallbackField: string | undefined,
): OperationName {
  const base = camel(
    operationName ?? fallbackField ?? (operationType === 'query' ? 'query' : 'mutation'),
  );
  const match = GRAPHQL_VERB_PREFIXES.find((entry) => base.toLowerCase().startsWith(entry.prefix));
  const verb: OperationVerb = match?.verb ?? (operationType === 'query' ? 'read' : 'custom');
  const entity = match ? camel(base.slice(match.prefix.length)) || base : base;
  return { name: base, verb, entity };
}

/** Appends a numeric suffix until the name is unique within `taken`. */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  let index = 2;
  while (taken.has(`${name}${index}`)) index += 1;
  return `${name}${index}`;
}

export { camel, pascal, plural };
