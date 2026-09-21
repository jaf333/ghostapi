import 'server-only';
import { GhostStore } from '@ghostapi/store';
import {
  confidenceBand,
  describeAuth,
  isNetworkObservation,
  type Operation,
  type Target,
} from '@ghostapi/core';

export function store(): GhostStore {
  return GhostStore.resolve(process.env.GHOSTAPI_CWD ?? process.cwd());
}

export interface TargetSummary {
  readonly target: Target;
  readonly operations: number;
  readonly verified: number;
  readonly sessions: number;
  readonly hasSession: boolean;
}

export async function listTargetSummaries(): Promise<TargetSummary[]> {
  const ghost = store();
  const targets = await ghost.listTargets();
  return Promise.all(
    targets.map(async (target) => {
      const operations = await ghost.listOperations(target.slug);
      const sessions = await ghost.listSessions(target.slug);
      const auth = await ghost.readAuth(target.slug);
      return {
        target,
        operations: operations.length,
        verified: operations.filter((operation) => operation.verified).length,
        sessions: sessions.length,
        hasSession: (auth?.cookies.length ?? 0) > 0,
      };
    }),
  );
}

export interface FeedEntry {
  readonly at: number;
  readonly method: string;
  readonly path: string;
  readonly status?: number;
  readonly durationMs?: number;
}

/** The most recent session's network traffic, newest first. */
export async function recentFeed(slug: string, limit = 40): Promise<FeedEntry[]> {
  const ghost = store();
  const [latest] = await ghost.listSessions(slug);
  if (!latest) return [];
  const observations = await ghost.readSessionObservations(slug, latest.id);
  return observations
    .filter(isNetworkObservation)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit)
    .map((observation) => ({
      at: observation.startedAt,
      method: observation.method,
      path: observation.path,
      status: observation.status,
      durationMs: observation.durationMs,
    }));
}

export interface OperationView {
  readonly operation: Operation;
  readonly band: ReturnType<typeof confidenceBand>;
  readonly authLabel: string;
  readonly transports: string[];
  readonly request: string;
}

export function viewOperation(operation: Operation): OperationView {
  const transport = operation.transport;
  const request =
    transport.type === 'http'
      ? `${transport.method} ${transport.urlTemplate}`
      : transport.type === 'graphql'
        ? `GraphQL ${transport.operationName ?? 'operation'} → ${transport.endpoint}`
        : transport.type === 'browser'
          ? `browser · ${transport.steps.length} recorded step(s)`
          : `WebMCP · ${transport.toolName}`;
  return {
    operation,
    band: confidenceBand(operation),
    authLabel: describeAuth(operation.auth),
    transports: [operation.transport, ...operation.fallbacks].map((item) => item.type),
    request,
  };
}
