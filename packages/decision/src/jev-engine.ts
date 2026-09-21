import { DecisionUnavailableError, type ChoiceRequest, type Decision, type DecisionEngine } from './engine.js';

interface ChoiceAnswer {
  readonly type: 'choice';
  readonly choice: string;
  readonly confidence: number;
  readonly probabilities: Record<string, number>;
}

interface SystemOneResult {
  readonly model: string;
  readonly answers: Record<string, ChoiceAnswer>;
  readonly usage: { input_tokens: number; output_tokens: number };
}

interface TypeSafeClientLike {
  systemOne(request: {
    state: unknown;
    questions: Record<string, unknown>;
  }): Promise<SystemOneResult>;
}

interface TypeSafeModule {
  TypeSafeClient: new (config?: Record<string, unknown>) => TypeSafeClientLike;
  choice: (instructions: unknown, criteria: Record<string, unknown>) => unknown;
}

/**
 * Jev, through TypeSafe AI's own SDK.
 *
 * Jev is a decision model: it answers typed questions with a confidence and a
 * probability distribution, and it cannot write prose. That is exactly the
 * shape of the choices GhostAPI needs to make repeatedly, which is why it is
 * here and not a chat model.
 *
 * Loaded dynamically so that a workspace without a TypeSafe key — the common
 * case, and the one CI runs in — still builds and runs.
 */
export class JevDecisionEngine implements DecisionEngine {
  readonly name = 'jev';
  private readonly apiKey: string | undefined;
  private readonly model: string | undefined;
  private client: TypeSafeClientLike | undefined;
  private choiceBuilder: TypeSafeModule['choice'] | undefined;

  constructor(options: { apiKey?: string; model?: string } = {}) {
    this.apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY;
    this.model = options.model ?? process.env.TYPESAFE_DEFAULT_MODEL;
  }

  async available(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      await this.load();
      return true;
    } catch {
      return false;
    }
  }

  private async load(): Promise<TypeSafeModule> {
    const module = (await import('@typesafe-ai/sdk')) as unknown as TypeSafeModule;
    if (!module?.TypeSafeClient || !module?.choice) {
      throw new DecisionUnavailableError(this.name, '@typesafe-ai/sdk did not export the expected API');
    }
    return module;
  }

  async choose<T extends string>(request: ChoiceRequest<T>): Promise<Decision<T>> {
    if (!this.apiKey) {
      throw new DecisionUnavailableError(this.name, 'TYPESAFE_API_KEY is not set');
    }
    const module = await this.load();
    if (!this.client) {
      this.client = new module.TypeSafeClient({
        apiKey: this.apiKey,
        ...(this.model ? { defaultModel: this.model } : {}),
      });
      this.choiceBuilder = module.choice;
    }
    const criteria: Record<string, unknown> = {};
    for (const option of request.choices) {
      criteria[option] = request.criteria?.[option] ?? null;
    }

    const result = await this.client.systemOne({
      state: request.state,
      questions: {
        selection: (this.choiceBuilder as TypeSafeModule['choice'])(request.instructions, criteria),
      },
    });

    const answer = result.answers.selection;
    if (!answer || typeof answer.choice !== 'string') {
      throw new DecisionUnavailableError(this.name, 'the model returned no selection');
    }
    return {
      choice: answer.choice as T,
      confidence: answer.confidence,
      probabilities: answer.probabilities,
      engine: `${this.name}:${result.model}`,
      usage: {
        inputTokens: result.usage?.input_tokens,
        outputTokens: result.usage?.output_tokens,
      },
    };
  }
}
