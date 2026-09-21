import type { JsonSchema } from './json-schema.js';

/**
 * Sentinel written in place of anything that looked like a credential.
 * It is a plain string so that downstream schema inference still sees the
 * original JSON shape, and it is distinctive enough to assert on in tests.
 */
export const REDACTED = '__ghostapi_redacted__';

export const SENSITIVE_HEADERS: readonly string[] = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
  'x-csrf-token',
  'x-xsrf-token',
  'x-session-token',
  'x-amz-security-token',
  'api-key',
  'apikey',
  'authentication',
];

export const SENSITIVE_KEY_PATTERNS: readonly RegExp[] = [
  /pass(word|wd|phrase)?$/i,
  /^pwd$/i,
  /secret/i,
  /token/i,
  /^auth$/i,
  /authorization/i,
  /api[-_]?key/i,
  /access[-_]?key/i,
  /private[-_]?key/i,
  /credential/i,
  /session[-_]?id$/i,
  /^otp$/i,
  /^pin$/i,
  /card[-_]?number/i,
  /^cvv$/i,
  /^ssn$/i,
];

/** High-signal credential formats. Kept narrow on purpose: false positives destroy schema inference. */
export const SENSITIVE_VALUE_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  { name: 'jwt', pattern: /^ey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}$/ },
  { name: 'bearer', pattern: /^Bearer\s+\S{8,}$/i },
  { name: 'basic', pattern: /^Basic\s+\S{8,}$/i },
  { name: 'openai-key', pattern: /^sk-[A-Za-z0-9_-]{16,}$/ },
  { name: 'github-token', pattern: /^gh[pousr]_[A-Za-z0-9]{16,}$/ },
  { name: 'aws-access-key-id', pattern: /^(AKIA|ASIA)[0-9A-Z]{12,}$/ },
  { name: 'slack-token', pattern: /^xox[abprs]-[A-Za-z0-9-]{10,}$/ },
  { name: 'google-api-key', pattern: /^AIza[0-9A-Za-z_-]{30,}$/ },
  { name: 'stripe-key', pattern: /^[rs]k_(live|test)_[A-Za-z0-9]{16,}$/ },
  { name: 'private-key-block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

export interface RedactionRecord {
  /** Dotted path within the redacted document, e.g. "body.user.password". */
  readonly path: string;
  /** Why the redactor fired: header name, key pattern or value pattern name. */
  readonly reason: string;
  /** Original JSON type, preserved so schema inference stays honest. */
  readonly originalType: 'string' | 'number' | 'boolean' | 'object' | 'array';
  readonly originalLength?: number;
}

export interface RedactionResult<T> {
  readonly value: T;
  readonly redactions: RedactionRecord[];
}

export interface SecretRedactorOptions {
  /** Extra header names to always redact, lowercased on use. */
  readonly extraHeaders?: readonly string[];
  /** Extra key regexes to always redact. */
  readonly extraKeyPatterns?: readonly RegExp[];
  /**
   * Literal values known to be secret for this session (e.g. the live cookie
   * string). They are scrubbed from every string anywhere in the document.
   */
  readonly literals?: readonly string[];
  /** Minimum literal length considered worth scrubbing. Guards against scrubbing "a". */
  readonly minLiteralLength?: number;
}

/**
 * Redacts credentials from anything GhostAPI is about to persist, print or export.
 *
 * Design rule: redaction happens at the boundary where evidence enters the
 * system, not at the boundary where it leaves. Nothing sensitive is ever written
 * to disk in the first place, so an export can never leak what a capture kept.
 */
export class SecretRedactor {
  private readonly headers: Set<string>;
  private readonly keyPatterns: RegExp[];
  private readonly literals: string[];

  constructor(options: SecretRedactorOptions = {}) {
    this.headers = new Set([
      ...SENSITIVE_HEADERS,
      ...(options.extraHeaders ?? []).map((h) => h.toLowerCase()),
    ]);
    this.keyPatterns = [...SENSITIVE_KEY_PATTERNS, ...(options.extraKeyPatterns ?? [])];
    const minLength = options.minLiteralLength ?? 8;
    this.literals = [...(options.literals ?? [])]
      .filter((literal) => literal.length >= minLength)
      .sort((a, b) => b.length - a.length);
  }

  withLiterals(literals: readonly string[]): SecretRedactor {
    return new SecretRedactor({
      extraHeaders: [...this.headers],
      extraKeyPatterns: this.keyPatterns,
      literals: [...this.literals, ...literals],
    });
  }

  isSensitiveHeader(name: string): boolean {
    return this.headers.has(name.toLowerCase());
  }

  isSensitiveKey(key: string): boolean {
    return this.keyPatterns.some((pattern) => pattern.test(key));
  }

  matchSensitiveValue(value: string): string | undefined {
    return SENSITIVE_VALUE_PATTERNS.find((entry) => entry.pattern.test(value.trim()))?.name;
  }

  redactHeaders(headers: Record<string, string>, basePath = 'headers'): RedactionResult<Record<string, string>> {
    const redactions: RedactionRecord[] = [];
    const value: Record<string, string> = {};
    for (const [rawName, rawValue] of Object.entries(headers)) {
      const name = rawName.toLowerCase();
      const path = `${basePath}.${name}`;
      if (this.isSensitiveHeader(name)) {
        redactions.push({
          path,
          reason: `sensitive-header:${name}`,
          originalType: 'string',
          originalLength: rawValue.length,
        });
        value[name] = REDACTED;
        continue;
      }
      const matched = this.matchSensitiveValue(rawValue);
      if (matched) {
        redactions.push({
          path,
          reason: `sensitive-value:${matched}`,
          originalType: 'string',
          originalLength: rawValue.length,
        });
        value[name] = REDACTED;
        continue;
      }
      value[name] = this.scrubLiterals(rawValue, path, redactions);
    }
    return { value, redactions };
  }

  redactValue<T>(input: T, basePath = ''): RedactionResult<T> {
    const redactions: RedactionRecord[] = [];
    const value = this.walk(input, basePath, redactions, false) as T;
    return { value, redactions };
  }

  /** Redacts a URL's query string while leaving the routable part readable. */
  redactUrl(rawUrl: string): { url: string; redactions: RedactionRecord[] } {
    const redactions: RedactionRecord[] = [];
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return { url: this.scrubLiterals(rawUrl, 'url', redactions), redactions };
    }
    if (parsed.username || parsed.password) {
      redactions.push({ path: 'url.userinfo', reason: 'url-credentials', originalType: 'string' });
      parsed.username = '';
      parsed.password = '';
    }
    for (const key of [...parsed.searchParams.keys()]) {
      const current = parsed.searchParams.get(key) ?? '';
      const matched = this.isSensitiveKey(key)
        ? `sensitive-key:${key}`
        : this.matchSensitiveValue(current)
          ? `sensitive-value:${this.matchSensitiveValue(current)}`
          : undefined;
      if (matched) {
        redactions.push({
          path: `url.query.${key}`,
          reason: matched,
          originalType: 'string',
          originalLength: current.length,
        });
        parsed.searchParams.set(key, REDACTED);
      } else if (this.literalHit(current)) {
        redactions.push({ path: `url.query.${key}`, reason: 'known-literal', originalType: 'string' });
        parsed.searchParams.set(key, REDACTED);
      }
    }
    return { url: parsed.toString(), redactions };
  }

  private walk(
    input: unknown,
    path: string,
    redactions: RedactionRecord[],
    parentKeyIsSensitive: boolean,
  ): unknown {
    if (input === null || input === undefined) return input;
    if (typeof input === 'string') {
      if (parentKeyIsSensitive) {
        redactions.push({
          path,
          reason: 'sensitive-key',
          originalType: 'string',
          originalLength: input.length,
        });
        return REDACTED;
      }
      const matched = this.matchSensitiveValue(input);
      if (matched) {
        redactions.push({
          path,
          reason: `sensitive-value:${matched}`,
          originalType: 'string',
          originalLength: input.length,
        });
        return REDACTED;
      }
      return this.scrubLiterals(input, path, redactions);
    }
    if (typeof input === 'number' || typeof input === 'boolean') {
      if (parentKeyIsSensitive) {
        redactions.push({
          path,
          reason: 'sensitive-key',
          originalType: typeof input === 'number' ? 'number' : 'boolean',
        });
        return typeof input === 'number' ? 0 : false;
      }
      return input;
    }
    if (Array.isArray(input)) {
      return input.map((item, index) =>
        this.walk(item, path ? `${path}[${index}]` : `[${index}]`, redactions, parentKeyIsSensitive),
      );
    }
    if (typeof input === 'object') {
      const output: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(input as Record<string, unknown>)) {
        const childPath = path ? `${path}.${key}` : key;
        output[key] = this.walk(child, childPath, redactions, this.isSensitiveKey(key));
      }
      return output;
    }
    return input;
  }

  private literalHit(value: string): boolean {
    return this.literals.some((literal) => value.includes(literal));
  }

  private scrubLiterals(value: string, path: string, redactions: RedactionRecord[]): string {
    let output = value;
    for (const literal of this.literals) {
      if (output.includes(literal)) {
        redactions.push({
          path,
          reason: 'known-literal',
          originalType: 'string',
          originalLength: literal.length,
        });
        output = output.split(literal).join(REDACTED);
      }
    }
    return output;
  }
}

export const defaultRedactor = new SecretRedactor();

/** True when a schema leaf only ever saw redacted values, so callers can skip it. */
export function isRedactedSchema(schema: JsonSchema): boolean {
  return Array.isArray(schema.enum) && schema.enum.length === 1 && schema.enum[0] === REDACTED;
}
