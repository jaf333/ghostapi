import { ErrorCodes, GhostError, describeAuth, type AuthStrategy } from '@ghostapi/core';

export interface SessionCookieLike {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly expires: number;
}

export interface AuthMaterial {
  /** Cookies for the target origin, held in memory only. */
  readonly cookies?: readonly SessionCookieLike[];
  /** Environment used to resolve header strategies. Defaults to process.env. */
  readonly env?: Record<string, string | undefined>;
}

export interface ResolvedAuth {
  readonly headers: Record<string, string>;
  readonly description: string;
  readonly expiresAt?: number;
}

function cookieHeader(cookies: readonly SessionCookieLike[]): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

/**
 * Turns an auth *reference* into the concrete headers one request needs.
 *
 * Runs at execution time and returns a value that is never persisted, never
 * logged and never exported. An operation on disk only ever says where the
 * credential comes from.
 */
export function resolveAuth(strategy: AuthStrategy, material: AuthMaterial): ResolvedAuth {
  const env = material.env ?? process.env;
  switch (strategy.strategy) {
    case 'none':
      return { headers: {}, description: describeAuth(strategy) };

    case 'browser-session': {
      const cookies = material.cookies ?? [];
      if (cookies.length === 0) {
        throw new GhostError({
          code: ErrorCodes.AuthExpired,
          title: 'No browser session available',
          detail:
            'This operation replays a session that the browser established, but no session cookies are stored for this target.',
          remedy:
            'Run `ghostapi open <url>`, sign in, then close the window to capture the session.',
        });
      }
      const soonest = cookies
        .map((cookie) => cookie.expires)
        .filter((expires) => expires > 0)
        .sort((a, b) => a - b)[0];
      return {
        headers: { cookie: cookieHeader(cookies) },
        description: describeAuth({
          strategy: 'browser-session',
          cookieNames: cookies.map((cookie) => cookie.name),
        }),
        expiresAt: soonest !== undefined ? soonest * 1000 : undefined,
      };
    }

    case 'header': {
      const value = env[strategy.env];
      if (!value) {
        throw new GhostError({
          code: ErrorCodes.AuthExpired,
          title: 'Missing credential',
          detail: `This operation authenticates with the ${strategy.header} header, taken from $${strategy.env}, which is not set.`,
          remedy: `Export the credential first:\n\n  export ${strategy.env}="…"\n\nGhostAPI never stores it.`,
        });
      }
      return {
        headers: { [strategy.header.toLowerCase()]: `${strategy.prefix ?? ''}${value}` },
        description: describeAuth(strategy),
      };
    }

    case 'cookie': {
      const value = env[strategy.env];
      if (!value) {
        throw new GhostError({
          code: ErrorCodes.AuthExpired,
          title: 'Missing credential',
          detail: `This operation needs a Cookie header from $${strategy.env}, which is not set.`,
          remedy: `Export the cookie first:\n\n  export ${strategy.env}="…"`,
        });
      }
      return { headers: { cookie: value }, description: describeAuth(strategy) };
    }
  }
}

/** Cookies whose domain matches the request URL, so nothing leaks cross-origin. */
export function cookiesForUrl(
  cookies: readonly SessionCookieLike[],
  url: string,
): SessionCookieLike[] {
  let host: string;
  let pathname: string;
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    pathname = parsed.pathname;
  } catch {
    return [];
  }
  const now = Date.now() / 1000;
  return cookies.filter((cookie) => {
    if (cookie.expires > 0 && cookie.expires < now) return false;
    const domain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
    const domainMatch = host === domain || host.endsWith(`.${domain}`);
    const pathMatch = pathname.startsWith(cookie.path || '/');
    return domainMatch && pathMatch;
  });
}
