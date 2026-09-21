import { isIP } from 'node:net';
import { ErrorCodes, GhostError } from './errors.js';
import type { Operation } from './operation.js';
import { DESTRUCTIVE_VERBS, READ_ONLY_VERBS } from './operation.js';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export interface UrlPolicy {
  /** Loopback and private ranges. Allowed by default: GhostAPI is a local tool
   *  and the reference target runs on localhost. Turned off for imported targets. */
  readonly allowPrivateNetwork: boolean;
}

export const DEFAULT_URL_POLICY: UrlPolicy = { allowPrivateNetwork: true };
export const IMPORTED_URL_POLICY: UrlPolicy = { allowPrivateNetwork: false };

function isPrivateIpv4(address: string): boolean {
  const [a = 0, b = 0] = address.split('.').map(Number);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/**
 * Extracts the IPv4 address embedded in an IPv4-mapped or IPv4-compatible IPv6
 * address.
 *
 * `new URL()` rewrites `[::ffff:169.254.169.254]` to `[::ffff:a9fe:a9fe]`, which
 * matches none of the textual IPv6 prefixes below. Without this, the cloud
 * metadata endpoint walks straight through the private-network block.
 */
function embeddedIpv4(host: string): string | undefined {
  const groups = host.split(':');
  const last = groups[groups.length - 1] ?? '';
  if (last.includes('.')) return isIP(last) === 4 ? last : undefined;
  if (groups.length < 3) return undefined;
  const mapped = /^(?:0*:)*(?:0*f{4}:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
  if (!mapped) return undefined;
  const high = Number.parseInt(mapped[1] as string, 16);
  const low = Number.parseInt(mapped[2] as string, 16);
  if (Number.isNaN(high) || Number.isNaN(low)) return undefined;
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host === '::' || host === '0:0:0:0:0:0:0:1') return true;
  if (isIP(host) === 4) return isPrivateIpv4(host);
  if (isIP(host) === 6) {
    if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return true;
    const embedded = embeddedIpv4(host);
    if (embedded !== undefined && isPrivateIpv4(embedded)) return true;
  }
  return false;
}

/**
 * Validates a URL before GhostAPI opens it or replays against it.
 *
 * This is the SSRF boundary. It matters most for a target definition that
 * arrived from somewhere else: an imported `.ghost` file is untrusted input and
 * must not be able to point execution at cloud metadata or an intranet host.
 */
export function assertSafeUrl(rawUrl: string, policy: UrlPolicy = DEFAULT_URL_POLICY): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new GhostError({
      code: ErrorCodes.UnsafeTarget,
      title: 'Invalid URL',
      detail: `${rawUrl} is not a valid absolute URL.`,
      remedy: 'Pass a full URL including the scheme, for example https://app.example.com.',
    });
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new GhostError({
      code: ErrorCodes.UnsafeTarget,
      title: 'Unsupported URL scheme',
      detail: `${parsed.protocol} is not allowed. GhostAPI only opens http and https URLs.`,
      remedy: 'Use an http:// or https:// URL.',
    });
  }
  if (parsed.username || parsed.password) {
    throw new GhostError({
      code: ErrorCodes.UnsafeTarget,
      title: 'Credentials in URL',
      detail: 'The URL embeds a username or password.',
      remedy: 'Remove the credentials from the URL and authenticate in the browser instead.',
    });
  }
  if (!policy.allowPrivateNetwork && isPrivateHost(parsed.hostname)) {
    throw new GhostError({
      code: ErrorCodes.UnsafeTarget,
      title: 'Private network address blocked',
      detail: `${parsed.hostname} resolves to a loopback, link-local or private range.`,
      remedy:
        'This target came from an imported file. Re-run with --allow-private-network only if you trust its source.',
    });
  }
  return parsed;
}

/**
 * Decides whether an operation mutates data the user cannot trivially recover.
 * Errs toward marking things destructive: a false positive costs one keypress,
 * a false negative costs the user's data.
 */
export function classifyDestructive(input: {
  verb: Operation['verb'];
  method?: string;
  name?: string;
}): boolean {
  if (DESTRUCTIVE_VERBS.includes(input.verb)) return true;
  if (READ_ONLY_VERBS.includes(input.verb)) return false;
  if (input.method === 'DELETE') return true;
  if (input.name && /(delete|remove|destroy|purge|archive|cancel|revoke|wipe)/i.test(input.name)) {
    return true;
  }
  return false;
}

export function classifyIdempotent(method: string | undefined, verb: Operation['verb']): boolean {
  if (verb === 'create') return false;
  if (!method) return READ_ONLY_VERBS.includes(verb);
  return ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'].includes(method);
}

export interface ConfirmationRequest {
  readonly operation: string;
  readonly reason: string;
  readonly summary: string;
}

export function requiresConfirmation(
  operation: Pick<Operation, 'name' | 'destructive'>,
  options: { yes: boolean },
): ConfirmationRequest | undefined {
  if (!operation.destructive || options.yes) return undefined;
  return {
    operation: operation.name,
    reason: 'operation is marked destructive',
    summary: `${operation.name} can remove or hide data that may not be recoverable.`,
  };
}

/**
 * Page content is untrusted. Anything GhostAPI lifts off a page and later shows
 * to a model goes through here first, so a page cannot smuggle instructions
 * into an operation description or a tool listing.
 */
const INJECTION_MARKERS: readonly RegExp[] = [
  /ignore (all )?(previous|prior|above) instructions/i,
  /disregard (the )?(system|previous) (prompt|instructions)/i,
  /you are now\b/i,
  /\bnew instructions?\b\s*[:：]/i,
  /<\s*\/?\s*(system|assistant|user)\s*>/i,
  /\bBEGIN SYSTEM PROMPT\b/i,
  /\bdeveloper mode\b/i,
];

export interface SanitizedText {
  readonly text: string;
  readonly flagged: string[];
}

export function sanitizePageText(input: string, maxLength = 280): SanitizedText {
  const flagged = INJECTION_MARKERS.filter((pattern) => pattern.test(input)).map((p) => p.source);
  const collapsed = input
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const text = collapsed.length > maxLength ? `${collapsed.slice(0, maxLength)}…` : collapsed;
  return { text, flagged };
}

/**
 * Names arriving from a page or an imported file become identifiers in
 * generated TypeScript and MCP tool names. Constrain them hard.
 */
export function assertSafeIdentifier(name: string, what = 'identifier'): string {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)) {
    throw new GhostError({
      code: ErrorCodes.UnsafeTarget,
      title: `Unsafe ${what}`,
      detail: `"${name}" is not a plain identifier.`,
      remedy: 'Rename the operation with `ghostapi rename <old> <new>` before exporting.',
    });
  }
  return name;
}

/** Blocks path traversal in anything used to build a filesystem path. */
export function assertSafePathSegment(segment: string): string {
  if (
    segment.length === 0 ||
    segment.includes('/') ||
    segment.includes('\\') ||
    segment.includes('\u0000') ||
    segment === '.' ||
    segment === '..'
  ) {
    throw new GhostError({
      code: ErrorCodes.UnsafeTarget,
      title: 'Unsafe path segment',
      detail: `"${segment}" cannot be used as a file or directory name.`,
      remedy: 'Use a slug made of letters, digits and dashes.',
    });
  }
  return segment;
}
