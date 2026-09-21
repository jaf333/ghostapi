import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import {
  assertSafeUrl,
  ErrorCodes,
  GhostError,
  newId,
  SecretRedactor,
  uiInteractionSchema,
  stateChangeSchema,
  type BrowserStep,
  type StateChange,
  type UiInteraction,
  type ValueBinding,
} from '@ghostapi/core';
import { CdpNetworkCapture } from './cdp-capture.js';
import { INSTRUMENT_BINDING, instrumentScript, type PageEvent } from './instrument.js';
import type {
  BrowserDriver,
  BrowserSession,
  BrowserStepResult,
  OpenSessionOptions,
  SessionCookie,
} from './types.js';

function resolveBinding(binding: ValueBinding, inputs: Record<string, unknown>): string {
  switch (binding.kind) {
    case 'literal':
      return binding.value === undefined || binding.value === null ? '' : String(binding.value);
    case 'input': {
      const value = inputs[binding.field];
      return value === undefined || value === null ? '' : String(value);
    }
    case 'object':
    case 'array':
      return JSON.stringify(binding);
  }
}

class PlaywrightSession implements BrowserSession {
  readonly sessionId: string;
  private readonly context: BrowserContext;
  private readonly page: Page;
  private readonly closed: Promise<void>;

  constructor(sessionId: string, context: BrowserContext, page: Page) {
    this.sessionId = sessionId;
    this.context = context;
    this.page = page;
    this.closed = new Promise<void>((resolve) => {
      context.once('close', () => resolve());
    });
  }

  async cookies(): Promise<SessionCookie[]> {
    const url = this.page.url();
    const raw = await this.context.cookies(url.startsWith('http') ? url : undefined);
    return raw.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
    }));
  }

  async currentUrl(): Promise<string> {
    return this.page.url();
  }

  async runSteps(
    steps: readonly BrowserStep[],
    inputs: Record<string, unknown>,
  ): Promise<BrowserStepResult> {
    const extracted: Record<string, string> = {};
    for (const step of steps) {
      switch (step.action) {
        case 'navigate':
          await this.page.goto(step.url, { waitUntil: 'domcontentloaded' });
          break;
        case 'click':
          await this.page.click(step.selector, { timeout: 10_000 });
          break;
        case 'fill':
          await this.setValue(step.selector, resolveBinding(step.value, inputs));
          break;
        case 'press':
          await this.page.keyboard.press(step.key);
          break;
        case 'waitFor':
          if (step.selector) {
            await this.page.waitForSelector(step.selector, { timeout: step.timeoutMs });
          } else if (step.urlContains) {
            await this.page.waitForURL((url) => url.href.includes(step.urlContains as string), {
              timeout: step.timeoutMs,
            });
          } else {
            // A bare wait is a settle hint, not an assertion. Some apps keep a
            // long-poll or a stream open and never reach network idle; failing
            // the whole operation over that would be wrong.
            await this.page
              .waitForLoadState('networkidle', { timeout: step.timeoutMs })
              .catch(() => this.page.waitForTimeout(Math.min(400, step.timeoutMs)));
          }
          break;
        case 'extract': {
          const locator = this.page.locator(step.selector).first();
          const value = step.attribute
            ? ((await locator.getAttribute(step.attribute)) ?? '')
            : ((await locator.textContent()) ?? '');
          extracted[step.as] = value.trim();
          break;
        }
      }
    }
    return { extracted, finalUrl: this.page.url() };
  }

  /** `fill` is the wrong verb for a select or a checkbox; dispatch on the element. */
  private async setValue(selector: string, value: string): Promise<void> {
    const locator = this.page.locator(selector).first();
    await locator.waitFor({ state: 'visible', timeout: 10_000 });
    const shape = await locator.evaluate((element) => {
      const tag = element.tagName.toLowerCase();
      const type = element.getAttribute('type')?.toLowerCase() ?? '';
      return tag === 'select'
        ? 'select'
        : type === 'checkbox' || type === 'radio'
          ? 'checkable'
          : 'text';
    });
    if (shape === 'select') {
      await locator.selectOption(value, { timeout: 10_000 });
      return;
    }
    if (shape === 'checkable') {
      await locator.setChecked(value !== '' && value !== 'false', { timeout: 10_000 });
      return;
    }
    await locator.fill(value, { timeout: 10_000 });
  }

  waitForClose(): Promise<void> {
    return this.closed;
  }

  async close(): Promise<void> {
    await this.context.close().catch(() => undefined);
  }
}

/**
 * Playwright-backed driver.
 *
 * Uses `launchPersistentContext` against a per-target profile directory so the
 * user signs in once, by hand, and GhostAPI never has to hold a password. CDP
 * is used directly for network capture because it is the only way to get
 * response bodies the page itself never exposes.
 */
export class PlaywrightDriver implements BrowserDriver {
  readonly name = 'playwright';

  async open(options: OpenSessionOptions): Promise<BrowserSession> {
    assertSafeUrl(options.url);
    await mkdir(options.profileDir, { recursive: true });

    const redactor = new SecretRedactor();
    const capture = new CdpNetworkCapture({
      sessionId: options.sessionId,
      sink: options.sink,
      redactor,
      ignorePatterns: options.ignorePatterns,
    });

    let context: BrowserContext;
    try {
      context = await chromium.launchPersistentContext(options.profileDir, {
        headless: options.headless,
        channel: options.channel && options.channel.length > 0 ? options.channel : undefined,
        viewport: options.viewport ?? { width: 1280, height: 860 },
        args: ['--disable-blink-features=AutomationControlled'],
      });
    } catch (error) {
      throw new GhostError(
        {
          code: ErrorCodes.BrowserUnavailable,
          title: 'Could not start Chrome',
          detail: error instanceof Error ? error.message : 'Playwright failed to launch a browser.',
          remedy:
            'Run `ghostapi doctor` to check the browser setup. Install Google Chrome, or set `browserChannel` to "" in .ghostapi/config.json to use a Playwright-managed build.',
        },
        { cause: error },
      );
    }

    if (options.cookies && options.cookies.length > 0) {
      await context
        .addCookies(
          options.cookies.map((cookie) => ({
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path || '/',
            expires: cookie.expires,
            httpOnly: cookie.httpOnly,
            secure: cookie.secure,
          })),
        )
        .catch(() => undefined);
    }

    await context.addInitScript(instrumentScript);
    await context.exposeBinding(INSTRUMENT_BINDING, (source, raw: PageEvent) => {
      this.handlePageEvent(options, redactor, source.page.url(), raw);
    });

    const attach = async (page: Page): Promise<void> => {
      try {
        const cdp = await context.newCDPSession(page);
        await capture.attach({
          send: (method, params) => cdp.send(method as never, params as never) as Promise<unknown>,
          on: (event, handler) => cdp.on(event as never, handler as never),
        });
      } catch {
        // A page can die before we attach; the session survives.
      }
    };

    context.on('page', (page) => void attach(page));
    const page = context.pages()[0] ?? (await context.newPage());
    await attach(page);
    await page.goto(options.url, { waitUntil: 'domcontentloaded' }).catch(() => undefined);

    return new PlaywrightSession(options.sessionId, context, page);
  }

  private handlePageEvent(
    options: OpenSessionOptions,
    redactor: SecretRedactor,
    pageUrl: string,
    raw: PageEvent,
  ): void {
    if (!raw || typeof raw !== 'object') return;
    const payload = redactor.redactValue(raw.payload ?? {}, '').value as Record<string, unknown>;
    if (raw.kind === 'ui') {
      const parsed = uiInteractionSchema.safeParse({
        ...payload,
        id: newId('ui'),
        sessionId: options.sessionId,
        kind: 'ui',
        at: raw.at,
        url: typeof payload.url === 'string' ? payload.url : pageUrl,
      } satisfies Partial<UiInteraction> & Record<string, unknown>);
      if (parsed.success) options.sink.ui(parsed.data);
      return;
    }
    const parsed = stateChangeSchema.safeParse({
      ...payload,
      id: newId('chg'),
      sessionId: options.sessionId,
      kind: 'state',
      at: raw.at,
    } satisfies Partial<StateChange> & Record<string, unknown>);
    if (parsed.success) options.sink.state(parsed.data);
  }
}
