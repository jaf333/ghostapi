import { z } from 'zod';
import { bodyKindSchema, httpMethodSchema } from './observation.js';

/**
 * How a value reaches the wire.
 *
 * Bindings are data, never code. An operation is a JSON document that a human
 * can read and audit; nothing in it is eval'd, templated by string splicing, or
 * interpreted as a program.
 */
export const valueBindingSchema: z.ZodType<ValueBinding> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal('literal'), value: z.unknown() }).strict(),
    z.object({ kind: z.literal('input'), field: z.string() }).strict(),
    z
      .object({
        kind: z.literal('object'),
        properties: z.record(valueBindingSchema),
      })
      .strict(),
    z.object({ kind: z.literal('array'), items: z.array(valueBindingSchema) }).strict(),
  ]),
);

export type ValueBinding =
  | { kind: 'literal'; value?: unknown }
  | { kind: 'input'; field: string }
  | { kind: 'object'; properties: Record<string, ValueBinding> }
  | { kind: 'array'; items: ValueBinding[] };

export const headerBindingSchema = z.union([
  z.object({ kind: z.literal('literal'), value: z.string() }).strict(),
  z.object({ kind: z.literal('input'), field: z.string() }).strict(),
  /** Value comes from the environment at execution time, never from the store. */
  z.object({ kind: z.literal('env'), env: z.string(), prefix: z.string().optional() }).strict(),
  /** Value comes from the live browser session's cookie jar. */
  z.object({ kind: z.literal('session') }).strict(),
]);
export type HeaderBinding = z.infer<typeof headerBindingSchema>;

export const httpTransportSchema = z
  .object({
    type: z.literal('http'),
    method: httpMethodSchema,
    /** Absolute URL template with {param} placeholders, e.g. https://x/api/todos/{id}. */
    urlTemplate: z.string(),
    /** Names of {param} placeholders, each bound from an input field of the same name. */
    pathParams: z.array(z.string()).default([]),
    query: z.record(valueBindingSchema).default({}),
    headers: z.record(headerBindingSchema).default({}),
    bodyKind: bodyKindSchema.default('none'),
    body: valueBindingSchema.optional(),
    /** Status codes the operation was observed to succeed with. */
    successStatuses: z.array(z.number()).default([200, 201, 204]),
  })
  .strict();
export type HttpTransport = z.infer<typeof httpTransportSchema>;

export const graphqlTransportSchema = z
  .object({
    type: z.literal('graphql'),
    endpoint: z.string(),
    operationName: z.string().optional(),
    operationType: z.enum(['query', 'mutation']).default('query'),
    /** The literal document observed on the wire. Never rewritten. */
    document: z.string(),
    variables: z.record(valueBindingSchema).default({}),
    headers: z.record(headerBindingSchema).default({}),
  })
  .strict();
export type GraphQLTransport = z.infer<typeof graphqlTransportSchema>;

export const browserStepSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('navigate'), url: z.string() }).strict(),
  z
    .object({
      action: z.literal('click'),
      selector: z.string(),
      description: z.string().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('fill'),
      selector: z.string(),
      value: valueBindingSchema,
      description: z.string().optional(),
    })
    .strict(),
  z.object({ action: z.literal('press'), key: z.string() }).strict(),
  z
    .object({
      action: z.literal('waitFor'),
      selector: z.string().optional(),
      urlContains: z.string().optional(),
      timeoutMs: z.number().default(10_000),
    })
    .strict(),
  z
    .object({
      action: z.literal('extract'),
      selector: z.string(),
      as: z.string(),
      attribute: z.string().optional(),
    })
    .strict(),
]);
export type BrowserStep = z.infer<typeof browserStepSchema>;

export const browserTransportSchema = z
  .object({
    type: z.literal('browser'),
    startUrl: z.string(),
    steps: z.array(browserStepSchema),
    /** Optional network assertion: the run only succeeds if this path is hit. */
    expectRequestPath: z.string().optional(),
  })
  .strict();
export type BrowserTransport = z.infer<typeof browserTransportSchema>;

export const webMcpTransportSchema = z
  .object({
    type: z.literal('webmcp'),
    pageUrl: z.string(),
    toolName: z.string(),
  })
  .strict();
export type WebMCPTransport = z.infer<typeof webMcpTransportSchema>;

export const transportSchema = z.discriminatedUnion('type', [
  httpTransportSchema,
  graphqlTransportSchema,
  browserTransportSchema,
  webMcpTransportSchema,
]);
export type Transport = z.infer<typeof transportSchema>;

export type TransportType = Transport['type'];

/**
 * Preference order when an operation can run more than one way.
 * The whole thesis of GhostAPI lives in this constant: the browser is the
 * teacher, the API is what actually does the work.
 */
export const TRANSPORT_PREFERENCE: readonly TransportType[] = [
  'http',
  'graphql',
  'webmcp',
  'browser',
];

export function transportRank(type: TransportType): number {
  const index = TRANSPORT_PREFERENCE.indexOf(type);
  return index === -1 ? TRANSPORT_PREFERENCE.length : index;
}

/** Input field names a binding tree reads. Used to cross-check the input schema. */
export function bindingInputFields(binding: ValueBinding | undefined): string[] {
  if (!binding) return [];
  switch (binding.kind) {
    case 'input':
      return [binding.field];
    case 'object':
      return Object.values(binding.properties).flatMap(bindingInputFields);
    case 'array':
      return binding.items.flatMap(bindingInputFields);
    case 'literal':
      return [];
  }
}

export function transportInputFields(transport: Transport): string[] {
  switch (transport.type) {
    case 'http': {
      const fromHeaders = Object.values(transport.headers)
        .filter((h): h is { kind: 'input'; field: string } => h.kind === 'input')
        .map((h) => h.field);
      return [
        ...transport.pathParams,
        ...Object.values(transport.query).flatMap(bindingInputFields),
        ...fromHeaders,
        ...bindingInputFields(transport.body),
      ];
    }
    case 'graphql':
      return Object.values(transport.variables).flatMap(bindingInputFields);
    case 'browser':
      return transport.steps.flatMap((step) =>
        step.action === 'fill' ? bindingInputFields(step.value) : [],
      );
    case 'webmcp':
      return [];
  }
}
