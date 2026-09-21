'use client';

import { useActionState } from 'react';
import { runOperation, type RunState } from '@/app/actions';

const initial: RunState = { status: 'idle' };

export function RunPanel({
  slug,
  name,
  destructive,
  sample,
}: {
  slug: string;
  name: string;
  destructive: boolean;
  sample: string;
}) {
  const [state, action, pending] = useActionState(runOperation.bind(null, slug, name), initial);

  if (destructive) {
    return (
      <p className="notice">
        This operation is marked destructive. Run it from the terminal, where the confirmation is
        explicit:
        <br />
        <span className="mono">
          ghostapi run {name} &apos;{sample}&apos; --yes
        </span>
      </p>
    );
  }

  return (
    <form action={action}>
      <textarea
        name="input"
        defaultValue={sample}
        spellCheck={false}
        aria-label="Operation input"
      />
      <div className="row" style={{ marginTop: 10 }}>
        <button type="submit" disabled={pending}>
          {pending ? 'Running…' : 'Run'}
        </button>
        {state.status === 'ok' ? (
          <span className="mono muted">
            {state.transport} · {state.latencyMs} ms · {state.traceId}
          </span>
        ) : null}
      </div>
      {state.status === 'error' ? (
        <pre className="error" style={{ marginTop: 12 }}>
          {state.message}
        </pre>
      ) : null}
      {state.status === 'ok' ? <pre style={{ marginTop: 12 }}>{state.body}</pre> : null}
    </form>
  );
}
