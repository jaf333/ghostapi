import { CONFIDENCE_VERIFIED } from '@ghostapi/core';

export interface ConfidenceInputs {
  readonly successfulObservations: number;
  readonly hasUiCorrelation: boolean;
  readonly payloadMatches: number;
  readonly hasStateEvidence: boolean;
  readonly typedRequestAndResponse: boolean;
  readonly verified: boolean;
}

export interface ConfidenceBreakdown {
  readonly value: number;
  readonly parts: { readonly label: string; readonly delta: number }[];
}

/**
 * Explicit, auditable confidence.
 *
 * Every term is something a person can check in `ghostapi inspect`. Nothing
 * here is a model output, and nothing reaches "verified" without an actual
 * successful replay outside the UI — the only evidence that really settles it.
 */
export function scoreConfidence(inputs: ConfidenceInputs): ConfidenceBreakdown {
  if (inputs.verified) {
    return { value: 0.97, parts: [{ label: 'replayed successfully without the UI', delta: 0.97 }] };
  }

  const parts: { label: string; delta: number }[] = [];
  const push = (label: string, delta: number): void => {
    if (delta > 0) parts.push({ label, delta: Number(delta.toFixed(3)) });
  };

  const base = inputs.successfulObservations > 0 ? 0.4 : 0.2;
  push(inputs.successfulObservations > 0 ? 'observed with a successful response' : 'observed', base);

  const repetition = Math.min(0.2, 0.05 * Math.max(0, inputs.successfulObservations - 1));
  push(`observed ${inputs.successfulObservations} time(s)`, repetition);

  const correlation = inputs.hasUiCorrelation ? 0.15 : 0;
  push('linked to a UI action', correlation);

  const payload = inputs.payloadMatches > 0 ? 0.1 : 0;
  push('entered values found in the request payload', payload);

  const state = inputs.hasStateEvidence ? 0.05 : 0;
  push('the application state changed afterwards', state);

  const typed = inputs.typedRequestAndResponse ? 0.05 : 0;
  push('structured request and response bodies', typed);

  const total = base + repetition + correlation + payload + state + typed;
  // Never claim certainty from observation alone; that band is reserved for a
  // verified replay.
  const value = Math.min(total, CONFIDENCE_VERIFIED - 0.01);
  return { value: Number(value.toFixed(3)), parts };
}
