import { z } from 'zod';
import { authStrategySchema } from './auth.js';
import { operationSchema } from './operation.js';

/** Endpoints that are never interesting as operations. Matched against the path. */
export const DEFAULT_IGNORE_PATTERNS: readonly string[] = [
  '/analytics',
  '/telemetry',
  '/_vercel/insights',
  '/__nextjs',
  '/_next/static',
  '/_next/webpack-hmr',
  '/hot-update',
  '/sockjs-node',
  '/favicon.ico',
  '/rum',
  '/beacon',
  '/collect',
  '/sentry',
  '/datadog',
  '/segment',
  '/gtag',
  '/google-analytics',
  '/hotjar',
  '/intercom',
  '/posthog',
  '/heartbeat',
  '/healthz',
];

export const targetSchema = z
  .object({
    slug: z.string(),
    name: z.string(),
    origin: z.string(),
    startUrl: z.string(),
    description: z.string().default(''),
    defaultAuth: authStrategySchema.default({ strategy: 'browser-session', cookieNames: [] }),
    ignorePatterns: z.array(z.string()).default([...DEFAULT_IGNORE_PATTERNS]),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();
export type Target = z.infer<typeof targetSchema>;

export const TARGET_BUNDLE_FORMAT = 1;

/**
 * Portable target definition. This is the unit a future registry would serve,
 * which is why it carries a format version and explicitly carries no session
 * material — only operations and the *description* of how to authenticate.
 */
export const targetBundleSchema = z
  .object({
    format: z.literal(TARGET_BUNDLE_FORMAT),
    generator: z.string(),
    exportedAt: z.number(),
    target: targetSchema,
    operations: z.array(operationSchema),
  })
  .strict();
export type TargetBundle = z.infer<typeof targetBundleSchema>;

export const configSchema = z
  .object({
    version: z.literal(1).default(1),
    defaultTarget: z.string().optional(),
    /** Chrome channel used for interactive sessions. */
    browserChannel: z.string().default('chrome'),
    decisionEngine: z.enum(['heuristic', 'jev', 'ai-sdk']).default('heuristic'),
    /** Model id used only for the rare discovery/compilation pass. */
    compilationModel: z.string().optional(),
  })
  .strict();
export type GhostConfig = z.infer<typeof configSchema>;

export const DEFAULT_CONFIG: GhostConfig = {
  version: 1,
  browserChannel: 'chrome',
  decisionEngine: 'heuristic',
};

export function shouldIgnorePath(path: string, patterns: readonly string[]): boolean {
  const lower = path.toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern.toLowerCase()));
}
