import { z } from 'zod';
import { authStrategySchema } from './auth.js';
import { jsonSchemaSchema } from './json-schema.js';
import { transportSchema } from './transport.js';

export const operationVerbSchema = z.enum([
  'create',
  'read',
  'list',
  'search',
  'update',
  'delete',
  'archive',
  'restore',
  'auth',
  'custom',
]);
export type OperationVerb = z.infer<typeof operationVerbSchema>;

/** Verbs that change data the user may not be able to get back. */
export const DESTRUCTIVE_VERBS: readonly OperationVerb[] = ['delete', 'archive'];
/** Verbs with no side effects at all. */
export const READ_ONLY_VERBS: readonly OperationVerb[] = ['read', 'list', 'search'];

export const evidenceSchema = z
  .object({
    kind: z.enum(['network', 'ui', 'state', 'repetition', 'inference', 'manual']),
    /** Id of the observation, interaction or state change this points at. */
    ref: z.string().optional(),
    note: z.string(),
    at: z.number(),
    /** Contribution to the operation's confidence, when the signal is scored. */
    score: z.number().optional(),
  })
  .strict();
export type Evidence = z.infer<typeof evidenceSchema>;

export const uiTriggerSchema = z
  .object({
    description: z.string(),
    selector: z.string().optional(),
    kind: z.enum(['click', 'submit', 'input', 'keydown', 'navigate', 'change']),
    count: z.number().default(1),
  })
  .strict();
export type UiTrigger = z.infer<typeof uiTriggerSchema>;

export const operationSchema = z
  .object({
    id: z.string(),
    /** Semantic camelCase name, e.g. createTodo — not postApiTodos. */
    name: z.string().regex(/^[a-z][A-Za-z0-9]*$/, 'operation names are camelCase identifiers'),
    description: z.string(),
    /** Singular entity the operation acts on, e.g. "todo". */
    entity: z.string().optional(),
    verb: operationVerbSchema,

    inputs: jsonSchemaSchema,
    output: jsonSchemaSchema.optional(),

    transport: transportSchema,
    /** Alternative ways to run the same operation, best-first after `transport`. */
    fallbacks: z.array(transportSchema).default([]),

    auth: authStrategySchema,

    confidence: z.number().min(0).max(1),
    evidence: z.array(evidenceSchema).default([]),
    uiTriggers: z.array(uiTriggerSchema).default([]),

    destructive: z.boolean(),
    idempotent: z.boolean().optional(),
    source: z.enum(['observed', 'inferred', 'manual']),

    observationCount: z.number().default(0),
    /** True once the operation has been replayed successfully outside the UI. */
    verified: z.boolean().default(false),
    lastVerifiedAt: z.number().optional(),

    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();
export type Operation = z.infer<typeof operationSchema>;

/**
 * Confidence bands. Deliberately coarse: a number like 0.83 invites false
 * precision, and the README promise is "never present a weak inference as
 * certainty".
 */
export const CONFIDENCE_VERIFIED = 0.95;
export const CONFIDENCE_LIKELY = 0.75;
export const CONFIDENCE_CANDIDATE = 0.45;

export type ConfidenceBand = 'verified' | 'likely' | 'candidate' | 'weak';

export function confidenceBand(operation: Pick<Operation, 'confidence' | 'verified'>): ConfidenceBand {
  if (operation.verified) return 'verified';
  if (operation.confidence >= CONFIDENCE_VERIFIED) return 'verified';
  if (operation.confidence >= CONFIDENCE_LIKELY) return 'likely';
  if (operation.confidence >= CONFIDENCE_CANDIDATE) return 'candidate';
  return 'weak';
}

export function isReadOnly(operation: Pick<Operation, 'verb'>): boolean {
  return READ_ONLY_VERBS.includes(operation.verb);
}

/** Immutably applies a patch, keeping `updatedAt` honest. */
export function updateOperation(operation: Operation, patch: Partial<Operation>): Operation {
  return { ...operation, ...patch, id: operation.id, updatedAt: Date.now() };
}

export function transportChain(operation: Operation): Operation['transport'][] {
  return [operation.transport, ...operation.fallbacks];
}
