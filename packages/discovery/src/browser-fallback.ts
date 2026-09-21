import type { BrowserStep, BrowserTransport, JsonSchema, UiInteraction } from '@ghostapi/core';

/**
 * Derives a browser-transport fallback from the interaction that produced an
 * operation.
 *
 * This is what keeps GhostAPI useful on applications whose API cannot be
 * replayed — signed request parameters, per-form CSRF tokens, anything where
 * the browser is genuinely load-bearing. The API path stays preferred; this is
 * the safety net, and it is derived from evidence rather than hand-written.
 */
export function buildBrowserFallback(
  interaction: UiInteraction,
  inputSchema: JsonSchema,
  expectRequestPath?: string,
): BrowserTransport | undefined {
  if (!interaction.selector) return undefined;

  const inputNames = new Set(Object.keys(inputSchema.properties ?? {}));
  const steps: BrowserStep[] = [
    { action: 'navigate', url: interaction.url },
    { action: 'waitFor', selector: interaction.selector, timeoutMs: 10_000 },
  ];

  for (const field of interaction.formFields) {
    if (field.redacted) continue;
    if (field.type === 'submit' || field.type === 'button') continue;
    const selector = `[name="${field.name}"]`;
    steps.push({
      action: 'fill',
      selector,
      value: inputNames.has(field.name)
        ? { kind: 'input', field: field.name }
        : { kind: 'literal', value: field.valueSample ?? '' },
      description: field.label ?? field.name,
    });
  }

  // A submit event targets the <form>; clicking a form does nothing. Replay the
  // control the browser reported as the submitter.
  const activation = interaction.submitterSelector ?? interaction.selector;
  steps.push({
    action: 'click',
    selector: activation,
    description: interaction.label ?? interaction.text ?? activation,
  });
  steps.push({ action: 'waitFor', timeoutMs: 10_000 });

  return {
    type: 'browser',
    startUrl: interaction.url,
    steps,
    ...(expectRequestPath ? { expectRequestPath } : {}),
  };
}
