/**
 * Page-side instrumentation.
 *
 * Runs in the page, before any app code. It reports *what the human did* — the
 * teacher half of GhostAPI's evidence. It deliberately reports structure
 * (selectors, labels, field names) and only short value samples, so the node
 * side can correlate a click with a request without hoarding page content.
 */
export const INSTRUMENT_BINDING = '__ghostapiReport';

export interface PageEvent {
  readonly kind: 'ui' | 'state';
  readonly at: number;
  readonly payload: Record<string, unknown>;
}

export const instrumentScript = `
(() => {
  const report = (kind, payload) => {
    try {
      if (typeof window.${INSTRUMENT_BINDING} === 'function') {
        window.${INSTRUMENT_BINDING}({ kind, at: Date.now(), payload });
      }
    } catch (_) { /* never break the page we are observing */ }
  };

  const MAX_SAMPLE = 120;
  const sample = (value) =>
    typeof value === 'string' ? value.slice(0, MAX_SAMPLE) : '';

  const isSensitiveField = (el) => {
    const type = (el.getAttribute('type') || '').toLowerCase();
    const name = ((el.getAttribute('name') || '') + ' ' + (el.id || '')).toLowerCase();
    const auto = (el.getAttribute('autocomplete') || '').toLowerCase();
    return (
      type === 'password' ||
      auto.includes('password') ||
      auto.includes('cc-') ||
      auto === 'one-time-code' ||
      /pass|secret|token|otp|cvv|card/.test(name)
    );
  };

  const cssEscape = (value) =>
    typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');

  const selectorFor = (el) => {
    if (!el || el.nodeType !== 1) return undefined;
    if (el.id) return '#' + cssEscape(el.id);
    for (const attr of ['data-testid', 'data-test', 'data-cy', 'name']) {
      const value = el.getAttribute && el.getAttribute(attr);
      if (value) return el.tagName.toLowerCase() + '[' + attr + '="' + value.replace(/"/g, '\\\\"') + '"]';
    }
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 6) {
      if (node.id) { parts.unshift('#' + cssEscape(node.id)); break; }
      const tag = node.tagName.toLowerCase();
      if (tag === 'html' || tag === 'body') { parts.unshift(tag); break; }
      const parent = node.parentElement;
      if (!parent) { parts.unshift(tag); break; }
      const siblings = Array.prototype.filter.call(parent.children, (c) => c.tagName === node.tagName);
      parts.unshift(siblings.length > 1 ? tag + ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')' : tag);
      node = parent;
      depth += 1;
    }
    return parts.join(' > ');
  };

  const labelFor = (el) => {
    if (!el || el.nodeType !== 1) return undefined;
    const aria = el.getAttribute('aria-label');
    if (aria) return sample(aria);
    if (el.id) {
      const label = document.querySelector('label[for="' + cssEscape(el.id) + '"]');
      if (label) return sample(label.textContent || '');
    }
    const closest = el.closest && el.closest('label');
    if (closest) return sample(closest.textContent || '');
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return sample(placeholder);
    return undefined;
  };

  const fieldsOf = (form) => {
    if (!form || !form.elements) return [];
    return Array.prototype.map
      .call(form.elements, (el) => {
        if (!el.name && !el.id) return undefined;
        const sensitive = isSensitiveField(el);
        return {
          name: el.name || el.id,
          type: (el.getAttribute('type') || el.tagName.toLowerCase()),
          label: labelFor(el),
          valueSample: sensitive ? undefined : sample(el.value),
          redacted: sensitive,
        };
      })
      .filter(Boolean);
  };

  const describe = (el) => ({
    selector: selectorFor(el),
    tagName: el && el.tagName ? el.tagName.toLowerCase() : undefined,
    role: el && el.getAttribute ? el.getAttribute('role') || undefined : undefined,
    label: labelFor(el),
    text: el && el.textContent ? sample(el.textContent.trim()) : undefined,
  });

  document.addEventListener(
    'click',
    (event) => {
      const el = event.target;
      if (!el || el.nodeType !== 1) return;
      const actionable = el.closest('button, a, [role="button"], input[type="submit"], input[type="checkbox"], [onclick]') || el;
      const form = actionable.closest ? actionable.closest('form') : null;
      report('ui', {
        type: 'click',
        ...describe(actionable),
        url: location.href,
        formFields: form ? fieldsOf(form) : [],
        modifiers: [event.metaKey && 'Meta', event.ctrlKey && 'Control', event.shiftKey && 'Shift', event.altKey && 'Alt'].filter(Boolean),
      });
    },
    true,
  );

  document.addEventListener(
    'submit',
    (event) => {
      const form = event.target;
      const submitter =
        event.submitter ||
        form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
      report('ui', {
        type: 'submit',
        ...describe(form),
        submitterSelector: submitter ? selectorFor(submitter) : undefined,
        url: location.href,
        formFields: fieldsOf(form),
        modifiers: [],
      });
    },
    true,
  );

  document.addEventListener(
    'change',
    (event) => {
      const el = event.target;
      if (!el || el.nodeType !== 1) return;
      const sensitive = isSensitiveField(el);
      report('ui', {
        type: 'change',
        ...describe(el),
        url: location.href,
        modifiers: [],
        formFields: [
          {
            name: el.name || el.id || 'value',
            type: (el.getAttribute('type') || el.tagName.toLowerCase()),
            label: labelFor(el),
            valueSample: sensitive ? undefined : sample(el.value),
            redacted: sensitive,
          },
        ],
      });
    },
    true,
  );

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Enter' && event.key !== 'Escape') return;
      const el = event.target;
      const form = el && el.closest ? el.closest('form') : null;
      report('ui', {
        type: 'keydown',
        ...describe(el),
        key: event.key,
        url: location.href,
        formFields: form ? fieldsOf(form) : [],
        modifiers: [event.metaKey && 'Meta', event.ctrlKey && 'Control', event.shiftKey && 'Shift'].filter(Boolean),
      });
    },
    true,
  );

  let pending = null;
  const observer = new MutationObserver((records) => {
    let added = 0;
    let removed = 0;
    const texts = [];
    for (const record of records) {
      added += record.addedNodes.length;
      removed += record.removedNodes.length;
      record.addedNodes.forEach((node) => {
        const text = (node.textContent || '').trim();
        if (text && texts.length < 5) texts.push(sample(text));
      });
    }
    if (added === 0 && removed === 0) return;
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      report('state', {
        type: 'dom-mutation',
        url: location.href,
        detail: added + ' nodes added, ' + removed + ' removed',
        addedTextSamples: texts,
      });
    }, 120);
  });

  const startObserving = () => {
    if (document.body) observer.observe(document.body, { childList: true, subtree: true, characterData: false });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserving);
  } else {
    startObserving();
  }

  const reportNavigation = () => report('state', { type: 'navigation', url: location.href, detail: 'navigated to ' + location.pathname, addedTextSamples: [] });
  const wrap = (method) => {
    const original = history[method];
    history[method] = function () {
      const result = original.apply(this, arguments);
      reportNavigation();
      return result;
    };
  };
  wrap('pushState');
  wrap('replaceState');
  window.addEventListener('popstate', reportNavigation);
})();
`;
