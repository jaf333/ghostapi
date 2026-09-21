import { describe, expect, it } from 'vitest';
import { SecretRedactor, type NetworkObservation } from '@ghostapi/core';
import { CdpNetworkCapture, type CdpLike } from './cdp-capture.js';

/** A CDP stand-in that lets a test drive the exact event sequence Chrome sends. */
class FakeCdp implements CdpLike {
  private readonly handlers = new Map<string, (payload: never) => void>();
  readonly sent: string[] = [];
  responseBody: string | undefined = '{"ok":true}';

  async send(method: string): Promise<unknown> {
    this.sent.push(method);
    if (method === 'Network.getResponseBody') {
      if (this.responseBody === undefined) throw new Error('no body');
      return { body: this.responseBody, base64Encoded: false };
    }
    return {};
  }

  on(event: string, handler: (payload: never) => void): void {
    this.handlers.set(event, handler);
  }

  emit(event: string, payload: Record<string, unknown>): void {
    this.handlers.get(event)?.(payload as never);
  }
}

function capture(sink: NetworkObservation[]): { capture: CdpNetworkCapture; cdp: FakeCdp } {
  const instance = new CdpNetworkCapture({
    sessionId: 'sess_test',
    sink: { network: (observation) => sink.push(observation), ui: () => {}, state: () => {} },
    redactor: new SecretRedactor(),
    ignorePatterns: ['/analytics'],
  });
  return { capture: instance, cdp: new FakeCdp() };
}

function requestEvent(id: string, url = 'https://app.example.com/api/todos', type = 'Fetch') {
  return {
    requestId: id,
    type,
    request: {
      url,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      postData: '{"title":"x"}',
    },
    initiator: { type: 'script' },
  };
}

describe('CdpNetworkCapture', () => {
  it('emits a redacted observation for a completed request', async () => {
    const observations: NetworkObservation[] = [];
    const { capture: instance, cdp } = capture(observations);
    await instance.attach(cdp);

    cdp.emit('Network.requestWillBeSent', requestEvent('1'));
    cdp.emit('Network.requestWillBeSentExtraInfo', {
      requestId: '1',
      headers: { Cookie: 'sid=super-secret-value' },
    });
    cdp.emit('Network.responseReceived', {
      requestId: '1',
      response: {
        status: 201,
        statusText: 'Created',
        headers: { 'content-type': 'application/json' },
      },
    });
    cdp.emit('Network.loadingFinished', { requestId: '1' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(observations).toHaveLength(1);
    const observation = observations[0] as NetworkObservation;
    expect(observation.status).toBe(201);
    expect(observation.requestHeaders.cookie).toBe('__ghostapi_redacted__');
    expect(observation.sensitiveRequestHeaders).toContain('cookie');
    expect(JSON.stringify(observation)).not.toContain('super-secret-value');
  });

  it('records side-channel headers even when they arrive before the request event', async () => {
    const observations: NetworkObservation[] = [];
    const { capture: instance, cdp } = capture(observations);
    await instance.attach(cdp);

    cdp.emit('Network.requestWillBeSentExtraInfo', {
      requestId: '1',
      headers: { Cookie: 'sid=abc12345' },
    });
    cdp.emit('Network.requestWillBeSent', requestEvent('1'));
    cdp.emit('Network.responseReceived', {
      requestId: '1',
      response: { status: 200, headers: {} },
    });
    cdp.emit('Network.loadingFinished', { requestId: '1' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(observations[0]?.sensitiveRequestHeaders).toContain('cookie');
  });

  it('skips ignored and static paths without leaving bookkeeping behind', async () => {
    const observations: NetworkObservation[] = [];
    const { capture: instance, cdp } = capture(observations);
    await instance.attach(cdp);

    cdp.emit('Network.requestWillBeSentExtraInfo', {
      requestId: '2',
      headers: { Cookie: 'sid=abc12345' },
    });
    cdp.emit('Network.requestWillBeSent', requestEvent('2', 'https://app.example.com/analytics'));
    cdp.emit('Network.requestWillBeSent', requestEvent('3', 'https://app.example.com/app.js'));

    expect(observations).toHaveLength(0);
    // Raw cookie values for a request nothing will consume must not be retained.
    expect(instance.inFlightCount.extraHeaders).toBe(0);
    expect(instance.inFlightCount.pending).toBe(0);
  });

  it('bounds in-flight bookkeeping when requests never finish', async () => {
    const observations: NetworkObservation[] = [];
    const { capture: instance, cdp } = capture(observations);
    await instance.attach(cdp);

    for (let index = 0; index < 5_000; index += 1) {
      cdp.emit('Network.requestWillBeSentExtraInfo', { requestId: `r${index}`, headers: {} });
      cdp.emit('Network.requestWillBeSent', requestEvent(`r${index}`));
    }

    expect(instance.inFlightCount.pending).toBeLessThanOrEqual(2_000);
    expect(instance.inFlightCount.extraHeaders).toBeLessThanOrEqual(2_000);
  });

  it('survives a response whose body cannot be read', async () => {
    const observations: NetworkObservation[] = [];
    const { capture: instance, cdp } = capture(observations);
    cdp.responseBody = undefined;
    await instance.attach(cdp);

    cdp.emit('Network.requestWillBeSent', requestEvent('1'));
    cdp.emit('Network.responseReceived', {
      requestId: '1',
      response: { status: 204, headers: {} },
    });
    cdp.emit('Network.loadingFinished', { requestId: '1' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(observations).toHaveLength(1);
    expect(observations[0]?.status).toBe(204);
  });

  it('emits an observation for a request that failed at the network layer', async () => {
    const observations: NetworkObservation[] = [];
    const { capture: instance, cdp } = capture(observations);
    await instance.attach(cdp);

    cdp.emit('Network.requestWillBeSent', requestEvent('1'));
    cdp.emit('Network.loadingFailed', { requestId: '1' });

    expect(observations).toHaveLength(1);
    expect(observations[0]?.status).toBeUndefined();
    expect(instance.inFlightCount.pending).toBe(0);
  });
});
