import {
  DecisionUnavailableError,
  type ChoiceRequest,
  type Decision,
  type DecisionEngine,
} from './engine.js';

const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v4/ai/evaluation-model';

interface GatewayResponse {
  answers?: Record<
    string,
    { type?: string; choice?: string; probabilities?: Record<string, number> }
  >;
  usage?: { inputTokens?: number; outputTokens?: number };
  providerMetadata?: { typesafe?: { confidence?: Record<string, number> } };
}

/**
 * The same decision model through the Vercel AI Gateway.
 *
 * Talks the evaluation-model protocol over plain fetch, so it adds no
 * dependency at all — and because the gateway is provider-routed, swapping
 * `model` points GhostAPI at a different decision model without touching a
 * line of pipeline code.
 */
export class GatewayDecisionEngine implements DecisionEngine {
  readonly name = 'gateway';
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: { apiKey?: string; model?: string; timeoutMs?: number } = {}) {
    this.apiKey = options.apiKey ?? process.env.AI_GATEWAY_API_KEY;
    this.model = options.model ?? process.env.GHOSTAPI_DECISION_MODEL ?? 'typesafe-ai/jev';
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async available(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async choose<T extends string>(request: ChoiceRequest<T>): Promise<Decision<T>> {
    if (!this.apiKey) {
      throw new DecisionUnavailableError(this.name, 'AI_GATEWAY_API_KEY is not set');
    }
    const criteria: Record<string, string> = {};
    for (const option of request.choices) {
      criteria[option] = request.criteria?.[option] ?? option;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let payload: GatewayResponse;
    try {
      const response = await fetch(GATEWAY_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
          'ai-gateway-protocol-version': '0.0.1',
          'ai-gateway-auth-method': 'api-key',
          'ai-evaluation-model-specification-version': '4',
          'ai-model-id': this.model,
        },
        body: JSON.stringify({
          state: request.state,
          questions: {
            selection: { type: 'choice', instructions: request.instructions, criteria },
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new DecisionUnavailableError(
          this.name,
          `gateway returned ${response.status} ${response.statusText}`,
        );
      }
      payload = (await response.json()) as GatewayResponse;
    } finally {
      clearTimeout(timer);
    }

    const answer = payload.answers?.selection;
    if (!answer?.choice) {
      throw new DecisionUnavailableError(this.name, 'the gateway returned no selection');
    }
    const confidence =
      payload.providerMetadata?.typesafe?.confidence?.selection ??
      answer.probabilities?.[answer.choice] ??
      0;

    return {
      choice: answer.choice as T,
      confidence,
      probabilities: answer.probabilities,
      engine: `${this.name}:${this.model}`,
      usage: {
        inputTokens: payload.usage?.inputTokens,
        outputTokens: payload.usage?.outputTokens,
      },
    };
  }
}
