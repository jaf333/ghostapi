import { GhostStore } from '@ghostapi/store';
import { PlaywrightDriver, type BrowserSession, type CaptureSink } from '@ghostapi/browser';
import {
  ErrorCodes,
  GhostError,
  newId,
  type BrowserTransport,
  type Operation,
  type Target,
} from '@ghostapi/core';
import type { AuthMaterial, BrowserRunner } from '@ghostapi/executor';

export async function openStore(): Promise<GhostStore> {
  const store = GhostStore.resolve();
  await store.init();
  return store;
}

/** Session cookies for one target, read from the local store at call time. */
export async function authFor(store: GhostStore, target: Target): Promise<AuthMaterial> {
  const auth = await store.readAuth(target.slug);
  return { cookies: auth?.cookies ?? [] };
}

export interface EphemeralBrowser extends BrowserRunner {
  observedRequests(): number;
  close(): Promise<void>;
}

/**
 * Starts a browser only when an operation actually needs one.
 *
 * Keeping this lazy is what lets the common path stay a single HTTP request:
 * nothing about running an API-backed operation should pay for Chrome.
 */
export async function startBrowserRunner(
  store: GhostStore,
  target: Target,
  options: { headless?: boolean } = {},
): Promise<EphemeralBrowser> {
  const config = await store.config();
  const stored = await store.readAuth(target.slug);
  const sessionId = newId('sess');
  let requestCount = 0;
  let seenPaths: string[] = [];
  const sink: CaptureSink = {
    network: (observation) => {
      requestCount += 1;
      seenPaths.push(observation.path);
    },
    ui: () => undefined,
    state: () => undefined,
  };

  const driver = new PlaywrightDriver();
  const session: BrowserSession = await driver.open({
    url: target.startUrl,
    sessionId,
    profileDir: store.targetProfileDir(target.slug),
    headless: options.headless ?? true,
    channel: config.browserChannel,
    ignorePatterns: target.ignorePatterns,
    cookies: stored?.cookies ?? [],
    sink,
  });

  return {
    async run(transport: BrowserTransport, inputs: Record<string, unknown>) {
      seenPaths = [];
      const result = await session.runSteps(transport.steps, inputs);
      // Let the request the steps triggered finish before asserting on it.
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (transport.expectRequestPath) {
        const expected = transport.expectRequestPath;
        const hit = seenPaths.some((path) => path === expected || path.startsWith(expected));
        if (!hit) {
          throw new GhostError({
            code: ErrorCodes.ExecutionFailed,
            title: 'Browser replay did not reach the backend',
            detail: `The recorded UI steps ran, but no request to ${expected} was observed. Requests seen: ${
              seenPaths.length > 0 ? [...new Set(seenPaths)].join(', ') : 'none'
            }.`,
            remedy:
              'The page may have changed, or the session may have expired. Run `ghostapi open <url>` to re-record this action.',
          });
        }
      }
      return result;
    },
    observedRequests: () => requestCount,
    close: () => session.close(),
  };
}

export function needsBrowser(operation: Operation): boolean {
  return [operation.transport, ...operation.fallbacks].every(
    (transport) => transport.type === 'browser',
  );
}
