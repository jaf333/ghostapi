export interface Decision<T extends string> {
  readonly choice: T;
  /** 0..1. What the engine itself reports, not a rescaled probability. */
  readonly confidence: number;
  readonly probabilities?: Readonly<Record<string, number>>;
  readonly engine: string;
  readonly rationale?: string;
  readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number };
}

export interface ChoiceRequest<T extends string> {
  /** Arbitrary JSON describing the situation. Never contains credentials. */
  readonly state: unknown;
  readonly choices: readonly T[];
  /** Per-choice descriptions. Decision models work far better with these. */
  readonly criteria?: Readonly<Partial<Record<T, string>>>;
  readonly instructions: string;
}

/**
 * A small decision, made well.
 *
 * GhostAPI uses this for the repeated, low-entropy choices in the pipeline —
 * which operation an intent means, which transport to try, whether an observed
 * request belongs to an action. It deliberately cannot generate text: anything
 * that needs prose is the wrong job for this interface.
 */
export interface DecisionEngine {
  readonly name: string;
  /** Whether this engine can run right now (credentials present, package installed). */
  available(): Promise<boolean>;
  choose<T extends string>(request: ChoiceRequest<T>): Promise<Decision<T>>;
}

export class DecisionUnavailableError extends Error {
  readonly engine: string;
  readonly reason: string;

  constructor(engine: string, reason: string) {
    super(`${engine} is unavailable: ${reason}`);
    this.name = 'DecisionUnavailableError';
    this.engine = engine;
    this.reason = reason;
  }
}
