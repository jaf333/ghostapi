import { GatewayDecisionEngine } from './gateway-engine.js';
import { HeuristicDecisionEngine } from './heuristic-engine.js';
import { JevDecisionEngine } from './jev-engine.js';
import type { DecisionEngine } from './engine.js';

export type EngineName = 'auto' | 'heuristic' | 'jev' | 'gateway';

export interface EngineSelection {
  readonly engine: DecisionEngine;
  /** Engines that were preferred but unavailable, with the reason. */
  readonly skipped: { readonly name: string; readonly reason: string }[];
}

/**
 * Picks a decision engine, preferring a real decision model when one is
 * reachable and degrading to the deterministic engine when it is not.
 *
 * GhostAPI never blocks on a model being available. A missing API key changes
 * how well routing works, not whether it works.
 */
export async function selectEngine(name: EngineName = 'auto'): Promise<EngineSelection> {
  const skipped: { name: string; reason: string }[] = [];

  const tryEngine = async (candidate: DecisionEngine): Promise<DecisionEngine | undefined> => {
    if (await candidate.available()) return candidate;
    skipped.push({
      name: candidate.name,
      reason:
        candidate.name === 'jev'
          ? 'TYPESAFE_API_KEY is not set (or @typesafe-ai/sdk is not installed)'
          : 'AI_GATEWAY_API_KEY is not set',
    });
    return undefined;
  };

  if (name === 'heuristic') return { engine: new HeuristicDecisionEngine(), skipped };
  if (name === 'jev') {
    const engine = await tryEngine(new JevDecisionEngine());
    return { engine: engine ?? new HeuristicDecisionEngine(), skipped };
  }
  if (name === 'gateway') {
    const engine = await tryEngine(new GatewayDecisionEngine());
    return { engine: engine ?? new HeuristicDecisionEngine(), skipped };
  }

  const jev = await tryEngine(new JevDecisionEngine());
  if (jev) return { engine: jev, skipped };
  const gateway = await tryEngine(new GatewayDecisionEngine());
  if (gateway) return { engine: gateway, skipped };
  return { engine: new HeuristicDecisionEngine(), skipped };
}
