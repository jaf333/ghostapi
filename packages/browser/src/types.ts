import type { NetworkObservation, StateChange, UiInteraction } from '@ghostapi/core';
import type { BrowserStep } from '@ghostapi/core';

export interface CaptureSink {
  network(observation: NetworkObservation): void;
  ui(interaction: UiInteraction): void;
  state(change: StateChange): void;
}

export interface SessionCookie {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly expires: number;
  readonly httpOnly: boolean;
  readonly secure: boolean;
}

export interface OpenSessionOptions {
  readonly url: string;
  readonly sessionId: string;
  /** Persistent Chrome user-data dir. Keeps the user's manual login across runs. */
  readonly profileDir: string;
  readonly headless: boolean;
  /** Chrome channel: 'chrome', 'msedge', 'chrome-beta'… Empty string uses the bundled build. */
  readonly channel?: string;
  readonly sink: CaptureSink;
  /** Paths that are never worth recording (analytics, HMR, static assets). */
  readonly ignorePatterns: readonly string[];
  readonly viewport?: { width: number; height: number };
  /**
   * Cookies to seed the context with before the first navigation.
   *
   * Session cookies are discarded by the browser on exit, by design, so a
   * persistent profile alone cannot carry a signed-in session between runs.
   * GhostAPI keeps its own session record and replays it here, which is what
   * makes the browser transport and the HTTP transport behave identically.
   */
  readonly cookies?: readonly SessionCookie[];
}

export interface BrowserStepResult {
  readonly extracted: Record<string, string>;
  readonly finalUrl: string;
}

/**
 * The seam between GhostAPI and whatever actually drives Chrome.
 *
 * Playwright is the default implementation. The interface exists because
 * agent-browser, a remote CDP endpoint or a hosted browser are all plausible
 * swaps, and none of them should require touching discovery or execution.
 */
export interface BrowserSession {
  readonly sessionId: string;
  /** Cookies for the session's origin, used to authorize replayed HTTP calls. */
  cookies(): Promise<SessionCookie[]>;
  currentUrl(): Promise<string>;
  runSteps(
    steps: readonly BrowserStep[],
    inputs: Record<string, unknown>,
  ): Promise<BrowserStepResult>;
  /** Resolves when the user closes the browser window. */
  waitForClose(): Promise<void>;
  close(): Promise<void>;
}

export interface BrowserDriver {
  readonly name: string;
  open(options: OpenSessionOptions): Promise<BrowserSession>;
}

export type { NetworkObservation, StateChange, UiInteraction };
