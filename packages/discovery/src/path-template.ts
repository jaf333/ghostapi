const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * `todo_9ab12c`, `usr-42`. The suffix must contain a digit, otherwise a
 * perfectly ordinary route like `user_profile` would be read as an id.
 */
const PREFIXED_ID = /^[a-z][a-z0-9]{1,12}[_-](?=[A-Za-z0-9]*\d)[A-Za-z0-9]{1,}$/;
const NUMERIC = /^\d+$/;
const HEX = /^[0-9a-f]{16,}$/i;
const BASE62 = /^[A-Za-z0-9_-]{16,}$/;

/** Does a single path segment look like an identifier rather than a route name? */
export function looksLikeIdentifier(segment: string): boolean {
  if (segment.length === 0) return false;
  return (
    UUID.test(segment) ||
    NUMERIC.test(segment) ||
    PREFIXED_ID.test(segment) ||
    HEX.test(segment) ||
    (BASE62.test(segment) && /\d/.test(segment))
  );
}

export interface PathTemplate {
  /** e.g. "/api/todos/{todoId}" */
  readonly template: string;
  /** Parameter names in path order. */
  readonly params: string[];
  /** Segments of the template, parameters wrapped in braces. */
  readonly segments: string[];
}

function singular(word: string): string {
  if (/ies$/i.test(word) && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(ses|xes|zes|ches|shes)$/i.test(word)) return word.slice(0, -2);
  if (/s$/i.test(word) && !/ss$/i.test(word)) return word.slice(0, -1);
  return word;
}

function paramNameFor(previousSegment: string | undefined, index: number): string {
  if (previousSegment && /^[a-zA-Z][\w-]*$/.test(previousSegment)) {
    const base = singular(previousSegment).replace(/[^A-Za-z0-9]/g, '');
    if (base.length > 0) return `${base.charAt(0).toLowerCase()}${base.slice(1)}Id`;
  }
  return `param${index}`;
}

/**
 * Derives a path template from one or more observed paths.
 *
 * With a single sample the only evidence available is the shape of each
 * segment. With several samples, a segment that *varies* is much stronger
 * evidence of a parameter than one that merely looks like an id, so varying
 * segments win.
 */
export function inferPathTemplate(paths: readonly string[]): PathTemplate {
  const splits = paths.map((path) => path.split('/').filter((part) => part.length > 0));
  const length = splits[0]?.length ?? 0;
  const uniform = splits.every((parts) => parts.length === length);
  if (!uniform || length === 0) {
    const only = splits[0] ?? [];
    return templateFrom(only.map((segment) => (looksLikeIdentifier(segment) ? undefined : segment)));
  }

  const segments: (string | undefined)[] = [];
  for (let index = 0; index < length; index += 1) {
    const values = splits.map((parts) => parts[index] as string);
    const distinct = new Set(values);
    const varies = distinct.size > 1;
    const identifierish = values.every((value) => looksLikeIdentifier(value));
    segments.push(varies || identifierish ? undefined : (values[0] as string));
  }
  return templateFrom(segments);
}

function templateFrom(segments: readonly (string | undefined)[]): PathTemplate {
  const params: string[] = [];
  const rendered = segments.map((segment, index) => {
    if (segment !== undefined) return segment;
    let name = paramNameFor(segments[index - 1], index);
    while (params.includes(name)) name = `${name}_${index}`;
    params.push(name);
    return `{${name}}`;
  });
  return {
    template: `/${rendered.join('/')}`,
    params,
    segments: rendered,
  };
}

/** Extracts parameter values from a concrete path using a template. */
export function matchPath(template: PathTemplate, path: string): Record<string, string> | undefined {
  const actual = path.split('/').filter((part) => part.length > 0);
  const expected = template.segments;
  if (actual.length !== expected.length) return undefined;
  const values: Record<string, string> = {};
  for (let index = 0; index < expected.length; index += 1) {
    const segment = expected[index] as string;
    const value = actual[index] as string;
    if (segment.startsWith('{') && segment.endsWith('}')) {
      values[segment.slice(1, -1)] = value;
    } else if (segment !== value) {
      return undefined;
    }
  }
  return values;
}

/** Stable key that groups observations of the same endpoint together. */
export function endpointKey(method: string, template: string, origin: string): string {
  return `${method} ${origin}${template}`;
}

export { singular };
