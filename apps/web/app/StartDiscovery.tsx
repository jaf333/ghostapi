'use client';

import { useActionState } from 'react';
import { startDiscovery, type DiscoveryState } from '@/app/actions';

const initial: DiscoveryState = { status: 'idle' };

export function StartDiscovery() {
  const [state, action, pending] = useActionState(startDiscovery, initial);

  return (
    <form action={action}>
      <div className="row">
        <input
          className="grow"
          type="url"
          name="url"
          placeholder="https://app.example.com"
          aria-label="Application URL"
          required
          spellCheck={false}
        />
        <button type="submit" disabled={pending}>
          {pending ? 'Opening…' : 'Start discovery'}
        </button>
      </div>
      {state.status === 'error' ? (
        <p className="error" style={{ marginBottom: 0 }}>
          {state.message}
        </p>
      ) : null}
      {state.status === 'started' ? (
        <p className="notice" style={{ marginTop: 12 }}>
          {state.message}
          <br />
          {state.slug ? (
            <a href={`/t/${state.slug}`} className="mono">
              /t/{state.slug}
            </a>
          ) : null}
        </p>
      ) : null}
    </form>
  );
}
