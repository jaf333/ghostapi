import { z } from 'zod';
import { jsonSchemaSchema } from './json-schema.js';

export const httpMethodSchema = z.enum([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);
export type HttpMethod = z.infer<typeof httpMethodSchema>;

export const bodyKindSchema = z.enum(['none', 'json', 'form', 'multipart', 'text', 'binary']);
export type BodyKind = z.infer<typeof bodyKindSchema>;

export const initiatorSchema = z
  .object({
    /** CDP initiator type: parser, script, preload, SignedExchange, preflight, other. */
    type: z.string(),
    url: z.string().optional(),
    /** Top frames of the JS stack that issued the request, already truncated. */
    stack: z.array(z.string()).default([]),
  })
  .strict();
export type Initiator = z.infer<typeof initiatorSchema>;

export const graphqlEnvelopeSchema = z
  .object({
    operationName: z.string().optional(),
    operationType: z.enum(['query', 'mutation', 'subscription']).optional(),
    query: z.string(),
    variables: z.unknown().optional(),
  })
  .strict();
export type GraphqlEnvelope = z.infer<typeof graphqlEnvelopeSchema>;

/**
 * One captured request/response pair. Already redacted: a NetworkObservation
 * never holds a credential, by construction.
 */
export const networkObservationSchema = z
  .object({
    id: z.string(),
    sessionId: z.string(),
    kind: z.literal('network'),
    startedAt: z.number(),
    completedAt: z.number().optional(),
    durationMs: z.number().optional(),

    method: httpMethodSchema,
    url: z.string(),
    origin: z.string(),
    path: z.string(),
    query: z.record(z.string()).default({}),

    requestHeaders: z.record(z.string()).default({}),
    requestBodyKind: bodyKindSchema.default('none'),
    requestBody: z.unknown().optional(),

    status: z.number().optional(),
    statusText: z.string().optional(),
    responseHeaders: z.record(z.string()).default({}),
    responseBodyKind: bodyKindSchema.default('none'),
    responseBody: z.unknown().optional(),

    resourceType: z.string().optional(),
    initiator: initiatorSchema.optional(),
    frameId: z.string().optional(),
    documentUrl: z.string().optional(),
    graphql: graphqlEnvelopeSchema.optional(),

    /** Number of credential values scrubbed before this record was created. */
    redactionCount: z.number().default(0),
    /**
     * Names — never values — of credential-bearing request headers that were
     * present. Header names are not secrets, and without them auth strategy
     * inference would have to guess.
     */
    sensitiveRequestHeaders: z.array(z.string()).default([]),
  })
  .strict();
export type NetworkObservation = z.infer<typeof networkObservationSchema>;

export const uiInteractionKindSchema = z.enum([
  'click',
  'submit',
  'input',
  'keydown',
  'navigate',
  'change',
]);
export type UiInteractionKind = z.infer<typeof uiInteractionKindSchema>;

export const formFieldSchema = z
  .object({
    name: z.string(),
    type: z.string(),
    label: z.string().optional(),
    /** Redacted sample of what the user typed, used to match request payloads. */
    valueSample: z.string().optional(),
    redacted: z.boolean().default(false),
  })
  .strict();
export type FormField = z.infer<typeof formFieldSchema>;

/** One thing the human did in the page. The "teacher" half of the evidence. */
export const uiInteractionSchema = z
  .object({
    id: z.string(),
    sessionId: z.string(),
    kind: z.literal('ui'),
    at: z.number(),
    type: uiInteractionKindSchema,
    /** Stable-ish selector recorded for browser-fallback replay. */
    selector: z.string().optional(),
    /**
     * For a submit, the control that actually submitted the form. Replaying a
     * submit means pressing that control; clicking the <form> itself does
     * nothing.
     */
    submitterSelector: z.string().optional(),
    tagName: z.string().optional(),
    role: z.string().optional(),
    label: z.string().optional(),
    text: z.string().optional(),
    key: z.string().optional(),
    modifiers: z.array(z.string()).default([]),
    frameId: z.string().optional(),
    url: z.string(),
    formFields: z.array(formFieldSchema).default([]),
  })
  .strict();
export type UiInteraction = z.infer<typeof uiInteractionSchema>;

export const stateChangeSchema = z
  .object({
    id: z.string(),
    sessionId: z.string(),
    kind: z.literal('state'),
    at: z.number(),
    type: z.enum(['navigation', 'dom-mutation', 'storage']),
    url: z.string().optional(),
    /** Short human-readable summary, e.g. "3 nodes added under [data-list]". */
    detail: z.string(),
    addedTextSamples: z.array(z.string()).default([]),
  })
  .strict();
export type StateChange = z.infer<typeof stateChangeSchema>;

export const observationSchema = z.discriminatedUnion('kind', [
  networkObservationSchema,
  uiInteractionSchema,
  stateChangeSchema,
]);
export type Observation = z.infer<typeof observationSchema>;

export const sessionSchema = z
  .object({
    id: z.string(),
    targetSlug: z.string(),
    startedAt: z.number(),
    endedAt: z.number().optional(),
    startUrl: z.string(),
    /** How the session was driven: a human in the loop, or a scripted run. */
    mode: z.enum(['interactive', 'scripted']),
    userAgent: z.string().optional(),
    counts: z
      .object({
        network: z.number().default(0),
        ui: z.number().default(0),
        state: z.number().default(0),
      })
      .default({ network: 0, ui: 0, state: 0 }),
  })
  .strict();
export type Session = z.infer<typeof sessionSchema>;

export const webMcpToolSchema = z
  .object({
    name: z.string(),
    description: z.string().default(''),
    inputSchema: jsonSchemaSchema.optional(),
    pageUrl: z.string(),
  })
  .strict();
export type WebMcpTool = z.infer<typeof webMcpToolSchema>;

export function isNetworkObservation(value: Observation): value is NetworkObservation {
  return value.kind === 'network';
}
export function isUiInteraction(value: Observation): value is UiInteraction {
  return value.kind === 'ui';
}
export function isStateChange(value: Observation): value is StateChange {
  return value.kind === 'state';
}
