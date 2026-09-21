import { z } from 'zod';

/**
 * Auth is referenced, never stored.
 *
 * GhostAPI holds a *description* of how a target authenticates. The material
 * itself lives either in the browser profile the user controls or in an
 * environment variable the user sets. That is what makes an exported operation
 * safe to commit, publish or hand to an agent.
 */
export const authStrategySchema = z.discriminatedUnion('strategy', [
  z.object({ strategy: z.literal('none') }).strict(),

  /** Reuse the cookie jar of the persistent browser profile for this target. */
  z
    .object({
      strategy: z.literal('browser-session'),
      /** Cookie names observed to matter, so `doctor` can report expiry. */
      cookieNames: z.array(z.string()).default([]),
    })
    .strict(),

  /** Header injected at execution time from the environment. */
  z
    .object({
      strategy: z.literal('header'),
      header: z.string(),
      env: z.string(),
      /** e.g. "Bearer " — prepended to the environment value. */
      prefix: z.string().optional(),
    })
    .strict(),

  /** Whole Cookie header supplied from the environment. */
  z.object({ strategy: z.literal('cookie'), env: z.string() }).strict(),
]);

export type AuthStrategy = z.infer<typeof authStrategySchema>;

export function describeAuth(auth: AuthStrategy): string {
  switch (auth.strategy) {
    case 'none':
      return 'no authentication observed';
    case 'browser-session':
      return auth.cookieNames.length > 0
        ? `browser session cookies (${auth.cookieNames.join(', ')})`
        : 'browser session cookies';
    case 'header':
      return `${auth.header} header from $${auth.env}`;
    case 'cookie':
      return `Cookie header from $${auth.env}`;
  }
}

/** Environment variables an operation needs before it can run. */
export function requiredEnvVars(auth: AuthStrategy): string[] {
  switch (auth.strategy) {
    case 'header':
    case 'cookie':
      return [auth.env];
    default:
      return [];
  }
}
