import { REDACTED, type NetworkObservation, type StateChange, type UiInteraction } from '@ghostapi/core';

export interface CorrelationSignal {
  readonly name: 'temporalProximity' | 'initiatorEvidence' | 'payloadSimilarity' | 'stateChangeEvidence' | 'repetitionEvidence';
  /** Normalised 0..1 strength of this individual signal. */
  readonly strength: number;
  readonly weight: number;
  readonly note: string;
}

export interface CorrelationCandidate {
  readonly interaction: UiInteraction;
  readonly score: number;
  readonly signals: CorrelationSignal[];
  /** Number of entered values found verbatim in the request. */
  readonly matchedValues: number;
}

export interface Correlation {
  readonly observation: NetworkObservation;
  readonly best?: CorrelationCandidate;
  readonly runnerUp?: CorrelationCandidate;
  /** True when the top two candidates are too close to separate on evidence alone. */
  readonly ambiguous: boolean;
}

export const CORRELATION_WEIGHTS = {
  temporalProximity: 0.35,
  initiatorEvidence: 0.15,
  payloadSimilarity: 0.3,
  stateChangeEvidence: 0.1,
  repetitionEvidence: 0.1,
} as const;

/** Above this, a UI action and a request are considered the same event. */
export const CORRELATION_THRESHOLD = 0.45;
/** Two candidates closer than this cannot be separated by scoring alone. */
export const AMBIGUITY_MARGIN = 0.08;

const MAX_LAG_MS = 4_000;
const IMMEDIATE_MS = 250;
const STATE_WINDOW_MS = 1_500;

function temporalStrength(interactionAt: number, requestAt: number): number {
  const delta = requestAt - interactionAt;
  if (delta < -50 || delta > MAX_LAG_MS) return 0;
  if (delta <= IMMEDIATE_MS) return 1;
  return Math.max(0, 1 - (delta - IMMEDIATE_MS) / (MAX_LAG_MS - IMMEDIATE_MS));
}

function initiatorStrength(observation: NetworkObservation): number {
  const type = observation.initiator?.type ?? 'other';
  if (type === 'script') return 1;
  if (type === 'preflight') return 0.6;
  if (type === 'other') return 0.5;
  if (type === 'parser') return 0.15;
  return 0.4;
}

function collectSearchable(observation: NetworkObservation): string {
  const parts: string[] = [JSON.stringify(observation.query ?? {})];
  if (observation.requestBody !== undefined) parts.push(JSON.stringify(observation.requestBody));
  return parts.join(' ').toLowerCase();
}

export interface PayloadSimilarity {
  readonly strength: number;
  readonly matched: string[];
  readonly total: number;
}

/**
 * How much of what the user typed shows up in what the app sent.
 * This is the strongest single signal available: timing can coincide, but a
 * form value appearing verbatim in a request body rarely does.
 */
export function payloadSimilarity(
  interaction: UiInteraction,
  observation: NetworkObservation,
): PayloadSimilarity {
  const values = interaction.formFields
    .filter((field) => !field.redacted)
    .map((field) => field.valueSample)
    .filter((value): value is string => typeof value === 'string' && value.trim().length >= 2)
    .filter((value) => value !== REDACTED);
  if (values.length === 0) return { strength: 0.5, matched: [], total: 0 };
  const haystack = collectSearchable(observation);
  const matched = values.filter((value) => haystack.includes(value.toLowerCase()));
  return { strength: matched.length / values.length, matched, total: values.length };
}

function stateStrength(observation: NetworkObservation, changes: readonly StateChange[]): number {
  const finishedAt = observation.completedAt ?? observation.startedAt;
  return changes.some(
    (change) => change.at >= finishedAt - 100 && change.at <= finishedAt + STATE_WINDOW_MS,
  )
    ? 1
    : 0;
}

export interface CorrelationContext {
  /** How many times this endpoint has been seen across all sessions. */
  readonly repetitionByEndpoint: ReadonlyMap<string, number>;
  readonly endpointKeyOf: (observation: NetworkObservation) => string;
}

export function scoreCorrelation(
  interaction: UiInteraction,
  observation: NetworkObservation,
  changes: readonly StateChange[],
  context: CorrelationContext,
): CorrelationCandidate {
  const temporal = temporalStrength(interaction.at, observation.startedAt);
  const initiator = initiatorStrength(observation);
  const payload = payloadSimilarity(interaction, observation);
  const state = stateStrength(observation, changes);
  const repeatCount = context.repetitionByEndpoint.get(context.endpointKeyOf(observation)) ?? 1;
  const repetition = Math.min(1, (repeatCount - 1) / 3);

  const signals: CorrelationSignal[] = [
    {
      name: 'temporalProximity',
      strength: temporal,
      weight: CORRELATION_WEIGHTS.temporalProximity,
      note: `request started ${observation.startedAt - interaction.at}ms after the ${interaction.type}`,
    },
    {
      name: 'initiatorEvidence',
      strength: initiator,
      weight: CORRELATION_WEIGHTS.initiatorEvidence,
      note: `initiator type ${observation.initiator?.type ?? 'unknown'}`,
    },
    {
      name: 'payloadSimilarity',
      strength: payload.strength,
      weight: CORRELATION_WEIGHTS.payloadSimilarity,
      note:
        payload.total === 0
          ? 'no form values to compare'
          : `${payload.matched.length}/${payload.total} entered values appear in the request`,
    },
    {
      name: 'stateChangeEvidence',
      strength: state,
      weight: CORRELATION_WEIGHTS.stateChangeEvidence,
      note: state > 0 ? 'the page changed right after the response' : 'no page change observed',
    },
    {
      name: 'repetitionEvidence',
      strength: repetition,
      weight: CORRELATION_WEIGHTS.repetitionEvidence,
      note: `endpoint observed ${repeatCount} time(s)`,
    },
  ];

  const score = signals.reduce((total, signal) => total + signal.strength * signal.weight, 0);
  return { interaction, score, signals, matchedValues: payload.matched.length };
}

/**
 * How committal an interaction is. A submit or a click is the user saying
 * "do it"; a change is them still filling the form in. When two candidates
 * score the same, the committal one is the better causal explanation.
 */
const INTENT_RANK: Record<string, number> = {
  submit: 5,
  click: 4,
  keydown: 3,
  change: 2,
  input: 1,
  navigate: 0,
};

function compareCandidates(a: CorrelationCandidate, b: CorrelationCandidate): number {
  if (Math.abs(a.score - b.score) > 1e-6) return b.score - a.score;
  if (a.matchedValues !== b.matchedValues) return b.matchedValues - a.matchedValues;
  const rankA = INTENT_RANK[a.interaction.type] ?? 0;
  const rankB = INTENT_RANK[b.interaction.type] ?? 0;
  if (rankA !== rankB) return rankB - rankA;
  // Closest in time wins the last tie.
  return b.interaction.at - a.interaction.at;
}

export interface CorrelateInput {
  readonly network: readonly NetworkObservation[];
  readonly interactions: readonly UiInteraction[];
  readonly changes: readonly StateChange[];
  readonly context: CorrelationContext;
}

/**
 * Links each request to the UI action that most plausibly caused it.
 *
 * One interaction may own several requests — a click that creates a todo also
 * triggers the list refresh — so there is no exclusivity on the interaction
 * side. A request, though, has exactly one cause.
 */
export function correlate(input: CorrelateInput): Correlation[] {
  return input.network.map((observation) => {
    const candidates = input.interactions
      .map((interaction) => scoreCorrelation(interaction, observation, input.changes, input.context))
      .filter((candidate) => candidate.score >= CORRELATION_THRESHOLD)
      .sort(compareCandidates);

    const best = candidates[0];
    const runnerUp = candidates[1];
    return {
      observation,
      best,
      runnerUp,
      ambiguous:
        best !== undefined && runnerUp !== undefined && best.score - runnerUp.score < AMBIGUITY_MARGIN,
    };
  });
}
