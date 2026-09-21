export interface BrowserHealth {
  readonly ok: boolean;
  readonly detail: string;
}

/** Answers "can this machine drive a browser at all?" for `ghostapi doctor`. */
export async function checkBrowserRuntime(): Promise<BrowserHealth> {
  try {
    const playwright = await import('playwright-core');
    const ok = typeof playwright.chromium?.launchPersistentContext === 'function';
    return {
      ok,
      detail: ok
        ? `playwright-core ready (${playwright.chromium.name()})`
        : 'playwright-core loaded but exposes no chromium launcher',
    };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
