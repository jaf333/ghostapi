import type { ChoiceRequest, Decision, DecisionEngine } from './engine.js';

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'to',
  'for',
  'of',
  'in',
  'on',
  'at',
  'with',
  'and',
  'or',
  'please',
  'me',
  'my',
  'i',
  'it',
  'that',
  'this',
  'new',
  'then',
  'can',
  'you',
  'would',
  'could',
]);

export function tokenize(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

/** Crude but effective stem: strips the plural and a couple of verb endings. */
function stem(token: string): string {
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith('es') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('s') && !token.endsWith('ss') && token.length > 3) return token.slice(0, -1);
  if (token.endsWith('ing') && token.length > 5) return token.slice(0, -3);
  if (token.endsWith('ed') && token.length > 4) return token.slice(0, -2);
  return token;
}

const VERB_SYNONYMS: Record<string, readonly string[]> = {
  create: ['create', 'add', 'make', 'new', 'insert', 'register', 'open', 'start'],
  read: ['get', 'read', 'show', 'fetch', 'view', 'detail', 'inspect'],
  list: ['list', 'all', 'show', 'browse', 'every'],
  search: ['search', 'find', 'look', 'query', 'filter', 'match'],
  update: ['update', 'change', 'edit', 'rename', 'set', 'modify', 'move', 'mark', 'complete'],
  delete: ['delete', 'remove', 'destroy', 'drop', 'erase'],
  archive: ['archive', 'hide', 'shelve', 'close'],
  restore: ['restore', 'unarchive', 'reopen'],
  auth: ['login', 'log', 'sign', 'authenticate', 'logout'],
};

function overlapScore(intentTokens: readonly string[], candidateText: string): number {
  const candidate = new Set(tokenize(candidateText).map(stem));
  if (candidate.size === 0) return 0;
  const intent = intentTokens.map(stem);
  const matches = intent.filter((token) => candidate.has(token)).length;
  return matches / Math.max(1, intent.length);
}

/**
 * The default engine: deterministic, offline, auditable.
 *
 * It exists so that `ghostapi ask` works on a plane, in CI and on a machine
 * with no API key — and so that every test of the routing layer measures the
 * routing layer rather than a remote model's mood. A hosted decision model is
 * strictly an upgrade, never a requirement.
 */
export class HeuristicDecisionEngine implements DecisionEngine {
  readonly name = 'heuristic';

  async available(): Promise<boolean> {
    return true;
  }

  async choose<T extends string>(request: ChoiceRequest<T>): Promise<Decision<T>> {
    const intentText =
      typeof request.state === 'string' ? request.state : JSON.stringify(request.state);
    const intentTokens = tokenize(intentText);

    const scored = request.choices.map((choice) => {
      const criteria = request.criteria?.[choice] ?? '';
      const nameScore = overlapScore(intentTokens, choice) * 2;
      const criteriaScore = overlapScore(intentTokens, criteria);
      const verbBonus = verbAffinity(intentTokens, choice, criteria);
      return { choice, raw: nameScore + criteriaScore + verbBonus };
    });

    const total = scored.reduce((sum, entry) => sum + Math.max(entry.raw, 0), 0);
    const probabilities: Record<string, number> = {};
    for (const entry of scored) {
      probabilities[entry.choice] = total > 0 ? Math.max(entry.raw, 0) / total : 1 / scored.length;
    }
    const best = [...scored].sort((a, b) => b.raw - a.raw)[0];
    if (!best) {
      throw new Error('choose() requires at least one choice');
    }
    const runnerUp = [...scored].sort((a, b) => b.raw - a.raw)[1];
    const margin = best.raw - (runnerUp?.raw ?? 0);
    // Confidence reflects separation, not enthusiasm: a narrow win reports low.
    const confidence = best.raw <= 0 ? 0 : Math.min(0.94, 0.5 + margin / Math.max(best.raw, 1) / 2);

    return {
      choice: best.choice,
      confidence: Number(confidence.toFixed(3)),
      probabilities,
      engine: this.name,
      rationale: `matched ${best.choice} on token overlap (margin ${margin.toFixed(2)} over ${runnerUp?.choice ?? 'nothing'})`,
    };
  }
}

/** Input names that mean an operation can answer a "find X" request. */
const SEARCHABLE_INPUTS = /\b(query|q|search|term|keyword|filter)\b/i;

function verbAffinity(intentTokens: readonly string[], choice: string, criteria: string): number {
  const stems = new Set(intentTokens.map(stem));
  let score = 0;
  for (const [verb, synonyms] of Object.entries(VERB_SYNONYMS)) {
    const lowerCriteria = criteria.toLowerCase();
    // An operation can serve a verb either by being named for it, or by taking
    // the input that verb needs. Plenty of applications have no dedicated
    // search endpoint — they have a list endpoint that accepts a query.
    const mentionsVerb =
      choice.toLowerCase().startsWith(verb) ||
      lowerCriteria.includes(`"${verb}"`) ||
      (verb === 'search' && SEARCHABLE_INPUTS.test(criteria));
    if (!mentionsVerb) continue;
    if (synonyms.some((synonym) => stems.has(stem(synonym)))) score += 1.5;
  }
  return score;
}
