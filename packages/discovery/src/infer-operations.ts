import {
  classifyDestructive,
  classifyIdempotent,
  isNetworkObservation,
  isStateChange,
  isUiInteraction,
  newId,
  operationSchema,
  sanitizePageText,
  shouldIgnorePath,
  type Evidence,
  type NetworkObservation,
  type Observation,
  type Operation,
  type StateChange,
  type Target,
  type UiInteraction,
  type UiTrigger,
} from '@ghostapi/core';
import { scoreConfidence } from './confidence.js';
import { correlate, type Correlation } from './correlate.js';
import { groupKeyOf, groupObservations, isApiLike, isSuccess } from './group.js';
import { analyzeEndpoint, nameGraphqlOperation, nameOperation, uniqueName } from './naming.js';
import { inferPathTemplate } from './path-template.js';
import { inferSchema, pickProperties } from './schema-infer.js';
import { inferAuth } from './auth-infer.js';
import { buildBrowserFallback } from './browser-fallback.js';
import {
  buildBodyBinding,
  buildHeaderBindings,
  buildHttpTransport,
  buildInputSchema,
  buildQueryBinding,
} from './transport-build.js';

export interface SkippedGroup {
  readonly key: string;
  readonly reason: string;
}

export interface DiscoveryResult {
  readonly operations: Operation[];
  readonly candidateGroups: number;
  readonly skipped: SkippedGroup[];
  readonly correlations: Correlation[];
  readonly ambiguities: number;
}

export interface DiscoveryOptions {
  readonly target: Target;
  readonly observations: readonly Observation[];
  /** Operations already known, so confidence and verification survive re-runs. */
  readonly existing?: readonly Operation[];
}

function splitObservations(observations: readonly Observation[]): {
  network: NetworkObservation[];
  interactions: UiInteraction[];
  changes: StateChange[];
} {
  return {
    network: observations.filter(isNetworkObservation),
    interactions: observations.filter(isUiInteraction),
    changes: observations.filter(isStateChange),
  };
}

/** Names of form fields the user could actually set, across linked interactions. */
function controlledFieldNames(interactions: readonly UiInteraction[]): string[] {
  return [
    ...new Set(
      interactions
        .flatMap((interaction) => interaction.formFields)
        .map((field) => field.name)
        .filter((name) => name.length > 0),
    ),
  ];
}

function enteredValues(interactions: readonly UiInteraction[]): string[] {
  return interactions
    .flatMap((interaction) => interaction.formFields)
    .filter((field) => !field.redacted)
    .map((field) => field.valueSample)
    .filter((value): value is string => typeof value === 'string' && value.length >= 2);
}

function describeTrigger(interaction: UiInteraction): UiTrigger {
  const label = sanitizePageText(
    interaction.label ?? interaction.text ?? interaction.selector ?? interaction.type,
    60,
  ).text;
  const shape =
    interaction.type === 'keydown'
      ? `${[...interaction.modifiers, interaction.key].filter(Boolean).join('+')} in ${interaction.tagName ?? 'page'}`
      : `${interaction.tagName ?? 'element'} "${label}"`;
  return {
    description: shape,
    selector: interaction.selector,
    kind: interaction.type,
    count: 1,
  };
}

function mergeTriggers(triggers: readonly UiTrigger[]): UiTrigger[] {
  const byKey = new Map<string, UiTrigger>();
  for (const trigger of triggers) {
    const key = `${trigger.kind}|${trigger.description}`;
    const existing = byKey.get(key);
    byKey.set(key, existing ? { ...existing, count: existing.count + 1 } : trigger);
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count);
}

/**
 * The compilation step: raw evidence in, reusable operations out.
 *
 * Deliberately deterministic. Every decision it makes is a rule a reader can
 * follow and a test can pin, which is what makes `ghostapi inspect` able to
 * explain *why* an operation exists.
 */
export function inferOperations(options: DiscoveryOptions): DiscoveryResult {
  const { network, interactions, changes } = splitObservations(options.observations);
  // Filter here as well as during capture: stored sessions may predate a
  // change to the ignore list, and an imported set was captured elsewhere.
  const apiLike = network
    .filter((observation) => !shouldIgnorePath(observation.path, options.target.ignorePatterns))
    .filter(isApiLike);

  const repetitionByEndpoint = new Map<string, number>();
  for (const observation of apiLike) {
    const key = groupKeyOf(observation);
    repetitionByEndpoint.set(key, (repetitionByEndpoint.get(key) ?? 0) + 1);
  }

  const correlations = correlate({
    network: apiLike,
    interactions,
    changes,
    context: { repetitionByEndpoint, endpointKeyOf: groupKeyOf },
  });
  const correlationById = new Map(correlations.map((item) => [item.observation.id, item]));

  // Credential headers observed anywhere on each origin.
  const originAuthHeaders = new Map<string, Set<string>>();
  for (const observation of apiLike) {
    if (observation.sensitiveRequestHeaders.length === 0) continue;
    const bucket = originAuthHeaders.get(observation.origin) ?? new Set<string>();
    for (const name of observation.sensitiveRequestHeaders) bucket.add(name);
    originAuthHeaders.set(observation.origin, bucket);
  }

  const groups = groupObservations(apiLike);
  const skipped: SkippedGroup[] = [];
  const taken = new Set<string>();
  const operations: Operation[] = [];

  for (const [key, members] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const successes = members.filter(isSuccess);
    if (successes.length === 0) {
      skipped.push({ key, reason: 'never observed with a successful response' });
      continue;
    }
    const operation = buildOperation({
      key,
      members,
      successes,
      correlationById,
      target: options.target,
      taken,
      existing: options.existing ?? [],
      originAuthHeaders,
    });
    if (!operation) {
      skipped.push({ key, reason: 'not enough evidence to describe an operation' });
      continue;
    }
    taken.add(operation.name);
    operations.push(operation);
  }

  return {
    operations,
    candidateGroups: groups.size,
    skipped,
    correlations,
    ambiguities: correlations.filter((item) => item.ambiguous).length,
  };
}

interface BuildInput {
  key: string;
  members: NetworkObservation[];
  successes: NetworkObservation[];
  correlationById: Map<string, Correlation>;
  target: Target;
  taken: Set<string>;
  existing: readonly Operation[];
  originAuthHeaders: Map<string, Set<string>>;
}

function buildOperation(input: BuildInput): Operation | undefined {
  const { successes, members, target } = input;
  const first = successes[0] as NetworkObservation;
  const linked = successes
    .map((observation) => input.correlationById.get(observation.id)?.best)
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined);
  const linkedInteractions = linked.map((candidate) => candidate.interaction);
  const entered = enteredValues(linkedInteractions);
  const controlled = controlledFieldNames(linkedInteractions);

  const graphql = first.graphql;
  const template = inferPathTemplate(successes.map((observation) => observation.path));

  // "search" is only the right word when searching is what usually happens
  // here. One request with ?query= does not make a list endpoint a search.
  const searchParamNames = ['q', 'query', 'search', 'term', 'keyword'];
  const withSearchParam = successes.filter((observation) =>
    Object.keys(observation.query).some((key) => searchParamNames.includes(key.toLowerCase())),
  ).length;
  const searchIsTypical = withSearchParam * 2 >= successes.length && withSearchParam > 0;

  const naming = graphql
    ? nameGraphqlOperation(
        graphql.operationName,
        graphql.operationType === 'mutation' ? 'mutation' : 'query',
        undefined,
      )
    : nameOperation({
        method: first.method,
        anatomy: analyzeEndpoint(template),
        queryKeys: searchIsTypical
          ? [...new Set(successes.flatMap((observation) => Object.keys(observation.query)))]
          : [],
        hasRequestBody: first.requestBodyKind !== 'none',
      });

  const name = uniqueName(naming.name, input.taken);

  const bodies = successes.map((observation) => observation.requestBody);
  const bodySchema = inferSchema(bodies.filter((body) => body !== undefined));
  const bodyBindingResult = buildBodyBinding(bodies, entered, controlled);
  const bodyBinding = graphql ? undefined : bodyBindingResult.binding;
  const bodyFields = graphql ? [] : bodyBindingResult.inputFields;

  const queryBinding = buildQueryBinding(successes, controlled);
  const querySchema = inferSchema(
    successes.map((observation) => observation.query),
  );

  const responseSchema = inferSchema(
    successes.map((observation) => observation.responseBody).filter((body) => body !== undefined),
  );

  const inputs = graphql
    ? inferSchema(
        successes.map((observation) => observation.graphql?.variables).filter((v) => v !== undefined),
      )
    : buildInputSchema({
        pathParams: template.params,
        bodySchema,
        bodyInputFields: bodyFields,
        querySchema: pickProperties(querySchema, queryBinding.inputFields),
        queryInputFields: queryBinding.inputFields,
      });

  const transport = graphql
    ? ({
        type: 'graphql' as const,
        endpoint: `${first.origin}${first.path}`,
        operationName: graphql.operationName,
        operationType: graphql.operationType === 'mutation' ? ('mutation' as const) : ('query' as const),
        document: graphql.query,
        variables: Object.fromEntries(
          Object.keys(inputs.properties ?? {}).map((field) => [
            field,
            { kind: 'input' as const, field },
          ]),
        ),
        headers: { 'content-type': { kind: 'literal' as const, value: 'application/json' } },
      })
    : buildHttpTransport({
        template,
        origin: first.origin,
        method: first.method,
        bodyKind: first.requestBodyKind,
        bodyBinding,
        query: queryBinding.query,
        headers: buildHeaderBindings(successes, first.requestBodyKind),
        successStatuses: successes
          .map((observation) => observation.status)
          .filter((status): status is number => status !== undefined),
      });

  const payloadMatches = linked.reduce(
    (total, candidate) =>
      total +
      (candidate.signals.find((signal) => signal.name === 'payloadSimilarity')?.strength ?? 0 > 0
        ? 1
        : 0),
    0,
  );
  const hasStateEvidence = linked.some(
    (candidate) =>
      (candidate.signals.find((signal) => signal.name === 'stateChangeEvidence')?.strength ?? 0) > 0,
  );

  const previous = input.existing.find((operation) => operation.name === name);
  const confidence = scoreConfidence({
    successfulObservations: successes.length + (previous?.observationCount ?? 0),
    hasUiCorrelation: linked.length > 0,
    payloadMatches,
    hasStateEvidence,
    typedRequestAndResponse:
      first.requestBodyKind === 'json' || first.responseBodyKind === 'json',
    verified: previous?.verified ?? false,
  });

  const evidence: Evidence[] = [
    ...successes.slice(0, 8).map<Evidence>((observation) => ({
      kind: 'network',
      ref: observation.id,
      note: `${observation.method} ${observation.path} → ${observation.status ?? '?'}`,
      at: observation.startedAt,
    })),
    ...linked.slice(0, 5).map<Evidence>((candidate) => ({
      kind: 'ui',
      ref: candidate.interaction.id,
      note: `${candidate.interaction.type} on ${
        sanitizePageText(candidate.interaction.label ?? candidate.interaction.selector ?? '', 40).text
      } (correlation ${candidate.score.toFixed(2)})`,
      at: candidate.interaction.at,
      score: candidate.score,
    })),
    {
      kind: 'repetition',
      note: `observed ${members.length} time(s), ${successes.length} successful`,
      at: Date.now(),
    },
  ];

  const fallbackInteraction = linkedInteractions.find((interaction) => interaction.selector);
  const fallback = fallbackInteraction
    ? buildBrowserFallback(fallbackInteraction, inputs, first.path)
    : undefined;

  const destructive = classifyDestructive({ verb: naming.verb, method: first.method, name });
  const now = Date.now();

  const parsed = operationSchema.safeParse({
    id: previous?.id ?? newId('op'),
    name,
    description: describeOperation(naming.verb, naming.entity, first, template.template),
    entity: naming.entity,
    verb: naming.verb,
    inputs,
    output: Object.keys(responseSchema).length > 0 ? responseSchema : undefined,
    transport,
    fallbacks: fallback ? [fallback] : [],
    auth: inferAuth(
      members,
      target.slug,
      // A sign-in request cannot carry the session it is about to create.
      naming.verb === 'auth' && first.method !== 'GET'
        ? []
        : [...(input.originAuthHeaders.get(first.origin) ?? [])],
    ),
    confidence: confidence.value,
    evidence,
    uiTriggers: mergeTriggers(linkedInteractions.map(describeTrigger)),
    destructive,
    idempotent: classifyIdempotent(first.method, naming.verb),
    source: 'observed',
    observationCount: successes.length + (previous?.observationCount ?? 0),
    verified: previous?.verified ?? false,
    lastVerifiedAt: previous?.lastVerifiedAt,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  });

  return parsed.success ? parsed.data : undefined;
}

function describeOperation(
  verb: string,
  entity: string,
  observation: NetworkObservation,
  template: string,
): string {
  const action =
    verb === 'list'
      ? `List ${entity} records`
      : verb === 'search'
        ? `Search ${entity} records`
        : verb === 'read'
          ? `Read one ${entity}`
          : verb === 'auth'
            ? `Authenticate against ${observation.origin}`
            : `${verb.charAt(0).toUpperCase()}${verb.slice(1)} a ${entity}`;
  return `${action}. Derived from ${observation.method} ${template}.`;
}
