import {
  httpMethodSchema,
  newId,
  SecretRedactor,
  shouldIgnorePath,
  type HttpMethod,
  type Initiator,
  type NetworkObservation,
} from '@ghostapi/core';
import { bodyKindFor, detectGraphql, looksStatic, parseBody } from './body.js';
import type { CaptureSink } from './types.js';

/** Minimal structural view of the CDP surface we use. */
export interface CdpLike {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, handler: (payload: never) => void): void;
}

interface PendingRequest {
  id: string;
  requestId: string;
  startedAt: number;
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  postData?: string;
  hasPostData: boolean;
  initiator?: Initiator;
  frameId?: string;
  documentUrl?: string;
  resourceType?: string;
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  responseMimeType?: string;
}

const CAPTURED_RESOURCE_TYPES = new Set([
  'XHR',
  'Fetch',
  'Document',
  'Other',
  'Ping',
  'EventSource',
]);
const MAX_STACK_FRAMES = 4;
/**
 * A request whose `loadingFinished` never arrives — the tab navigated away, a
 * service worker swallowed it, the socket died — would otherwise sit in memory
 * for the life of the session. Long interactive sessions are the normal case,
 * so both maps are bounded and evict oldest-first.
 */
const MAX_PENDING_REQUESTS = 2_000;
const MAX_PENDING_EXTRA_HEADERS = 2_000;

function evictOldest<K, V>(map: Map<K, V>, limit: number): void {
  while (map.size > limit) {
    const oldest = map.keys().next();
    if (oldest.done) return;
    map.delete(oldest.value);
  }
}

function lowerHeaders(headers: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    out[key.toLowerCase()] = String(value);
  }
  return out;
}

function toInitiator(raw: unknown): Initiator | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  const stackRoot = record.stack as
    { callFrames?: { url?: string; functionName?: string }[] } | undefined;
  const frames = (stackRoot?.callFrames ?? [])
    .slice(0, MAX_STACK_FRAMES)
    .map((frame) => `${frame.functionName || '(anonymous)'} @ ${frame.url ?? '?'}`);
  return {
    type: typeof record.type === 'string' ? record.type : 'other',
    url: typeof record.url === 'string' ? record.url : undefined,
    stack: frames,
  };
}

export interface CdpCaptureOptions {
  readonly sessionId: string;
  readonly sink: CaptureSink;
  readonly redactor: SecretRedactor;
  readonly ignorePatterns: readonly string[];
}

/**
 * Turns raw CDP network traffic into redacted NetworkObservations.
 *
 * Every field leaves here already scrubbed. Nothing downstream — the store, the
 * correlator, the exporters — ever has the chance to leak a credential, because
 * it never receives one.
 */
export class CdpNetworkCapture {
  private readonly pending = new Map<string, PendingRequest>();
  /**
   * Chrome adds Cookie and other network-layer headers *after* it emits
   * requestWillBeSent, and reports them separately. Without this map GhostAPI
   * would conclude that a cookie-authenticated app needs no auth at all.
   */
  private readonly extraRequestHeaders = new Map<string, Record<string, string>>();
  private readonly options: CdpCaptureOptions;
  private emitted = 0;

  constructor(options: CdpCaptureOptions) {
    this.options = options;
  }

  get observedCount(): number {
    return this.emitted;
  }

  /** In-flight bookkeeping, exposed so the bound on it can be asserted. */
  get inFlightCount(): { pending: number; extraHeaders: number } {
    return { pending: this.pending.size, extraHeaders: this.extraRequestHeaders.size };
  }

  async attach(cdp: CdpLike): Promise<void> {
    await cdp.send('Network.enable', {
      maxTotalBufferSize: 32 * 1024 * 1024,
      maxResourceBufferSize: 8 * 1024 * 1024,
    });

    cdp.on('Network.requestWillBeSent', (payload: never) => {
      this.onRequestWillBeSent(payload as unknown as Record<string, unknown>);
    });
    cdp.on('Network.requestWillBeSentExtraInfo', (payload: never) => {
      const record = payload as unknown as Record<string, unknown>;
      const requestId = String(record.requestId ?? '');
      if (!requestId) return;
      this.extraRequestHeaders.set(
        requestId,
        lowerHeaders(record.headers as Record<string, unknown> | undefined),
      );
      evictOldest(this.extraRequestHeaders, MAX_PENDING_EXTRA_HEADERS);
    });
    cdp.on('Network.responseReceived', (payload: never) => {
      this.onResponseReceived(payload as unknown as Record<string, unknown>);
    });
    cdp.on('Network.loadingFinished', (payload: never) => {
      // Fire-and-forget, so it must never reject: an unhandled rejection would
      // take the whole capture session down over one lost observation.
      void this.onLoadingFinished(cdp, payload as unknown as Record<string, unknown>).catch(
        () => undefined,
      );
    });
    cdp.on('Network.loadingFailed', (payload: never) => {
      this.onLoadingFailed(payload as unknown as Record<string, unknown>);
    });
  }

  private shouldCapture(url: string, resourceType: string | undefined): boolean {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (resourceType && !CAPTURED_RESOURCE_TYPES.has(resourceType)) return false;
    if (looksStatic(parsed.pathname)) return false;
    if (shouldIgnorePath(parsed.pathname, this.options.ignorePatterns)) return false;
    return true;
  }

  private onRequestWillBeSent(payload: Record<string, unknown>): void {
    const request = payload.request as Record<string, unknown> | undefined;
    const requestId = String(payload.requestId ?? '');
    const url = typeof request?.url === 'string' ? request.url : '';
    const resourceType = typeof payload.type === 'string' ? payload.type : undefined;
    if (!requestId) return;
    if (!this.shouldCapture(url, resourceType)) {
      // Nothing will ever consume this request's side-channel headers, and they
      // hold raw cookie values. Drop them as soon as we know.
      this.extraRequestHeaders.delete(requestId);
      return;
    }

    const methodResult = httpMethodSchema.safeParse(String(request?.method ?? 'GET').toUpperCase());
    if (!methodResult.success) return;

    this.pending.set(requestId, {
      id: newId('obs'),
      requestId,
      startedAt: Date.now(),
      method: methodResult.data,
      url,
      headers: lowerHeaders(request?.headers as Record<string, unknown> | undefined),
      postData: typeof request?.postData === 'string' ? request.postData : undefined,
      hasPostData: request?.hasPostData === true,
      initiator: toInitiator(payload.initiator),
      frameId: typeof payload.frameId === 'string' ? payload.frameId : undefined,
      documentUrl: typeof payload.documentURL === 'string' ? payload.documentURL : undefined,
      resourceType,
    });
    evictOldest(this.pending, MAX_PENDING_REQUESTS);
  }

  private onResponseReceived(payload: Record<string, unknown>): void {
    const entry = this.pending.get(String(payload.requestId ?? ''));
    if (!entry) return;
    const response = payload.response as Record<string, unknown> | undefined;
    entry.status = typeof response?.status === 'number' ? response.status : undefined;
    entry.statusText = typeof response?.statusText === 'string' ? response.statusText : undefined;
    entry.responseHeaders = lowerHeaders(response?.headers as Record<string, unknown> | undefined);
    entry.responseMimeType = typeof response?.mimeType === 'string' ? response.mimeType : undefined;
    if (typeof payload.type === 'string') entry.resourceType = payload.type;
  }

  private onLoadingFailed(payload: Record<string, unknown>): void {
    const requestId = String(payload.requestId ?? '');
    const entry = this.pending.get(requestId);
    if (!entry) return;
    this.pending.delete(requestId);
    this.mergeExtraHeaders(entry);
    this.emit(entry, undefined, undefined);
  }

  private async onLoadingFinished(cdp: CdpLike, payload: Record<string, unknown>): Promise<void> {
    const requestId = String(payload.requestId ?? '');
    const entry = this.pending.get(requestId);
    if (!entry) return;
    this.pending.delete(requestId);

    let postData = entry.postData;
    if (postData === undefined && entry.hasPostData) {
      postData = await this.safeSend<{ postData?: string }>(cdp, 'Network.getRequestPostData', {
        requestId,
      }).then((result) => result?.postData);
    }

    // A Document response body is the page itself, not data. Keeping it would
    // bloat every session with HTML that no operation is ever derived from.
    const wantsBody = entry.resourceType !== 'Document';
    const bodyResult = wantsBody
      ? await this.safeSend<{ body?: string; base64Encoded?: boolean }>(
          cdp,
          'Network.getResponseBody',
          {
            requestId,
          },
        )
      : undefined;
    const responseText = bodyResult?.base64Encoded === true ? undefined : bodyResult?.body;

    try {
      this.emit(entry, postData, responseText);
    } catch {
      // One malformed record is not worth ending the session over.
    }
  }

  private mergeExtraHeaders(entry: PendingRequest): void {
    const extra = this.extraRequestHeaders.get(entry.requestId);
    if (extra) {
      entry.headers = { ...entry.headers, ...extra };
      this.extraRequestHeaders.delete(entry.requestId);
    }
  }

  private async safeSend<T>(
    cdp: CdpLike,
    method: string,
    params: Record<string, unknown>,
  ): Promise<T | undefined> {
    try {
      return (await cdp.send(method, params)) as T;
    } catch {
      // Bodies evaporate on navigation and for some redirect chains. Losing one
      // sample is fine; losing the session because of it is not.
      return undefined;
    }
  }

  private emit(
    entry: PendingRequest,
    postData: string | undefined,
    responseText: string | undefined,
  ): void {
    const { redactor, sink, sessionId } = this.options;
    // Merged at the last possible moment: Chrome reports network-layer headers
    // (Cookie among them) on a separate event that can land after the response.
    this.mergeExtraHeaders(entry);

    const requestKind = bodyKindFor(entry.headers['content-type'], postData);
    const parsedRequest = parseBody(requestKind, postData);
    const responseKind = bodyKindFor(
      entry.responseHeaders?.['content-type'] ?? entry.responseMimeType,
      responseText,
    );
    const parsedResponse = parseBody(responseKind, responseText);

    const urlResult = redactor.redactUrl(entry.url);
    const parsedUrl = new URL(urlResult.url);
    const requestHeaders = redactor.redactHeaders(entry.headers, 'requestHeaders');
    const sensitiveRequestHeaders = requestHeaders.redactions
      .filter((record) => record.reason.startsWith('sensitive-'))
      .map((record) => record.path.replace(/^requestHeaders\./, ''));
    const responseHeaders = redactor.redactHeaders(entry.responseHeaders ?? {}, 'responseHeaders');
    const requestBody = redactor.redactValue(parsedRequest.value, 'requestBody');
    const responseBody = redactor.redactValue(parsedResponse.value, 'responseBody');
    const graphql = detectGraphql(requestBody.value);

    const completedAt = Date.now();
    const observation: NetworkObservation = {
      id: entry.id,
      sessionId,
      kind: 'network',
      startedAt: entry.startedAt,
      completedAt,
      durationMs: completedAt - entry.startedAt,
      method: entry.method,
      url: urlResult.url,
      origin: parsedUrl.origin,
      path: parsedUrl.pathname,
      query: Object.fromEntries(parsedUrl.searchParams.entries()),
      requestHeaders: requestHeaders.value,
      requestBodyKind: parsedRequest.kind,
      requestBody: requestBody.value,
      status: entry.status,
      statusText: entry.statusText,
      responseHeaders: responseHeaders.value,
      responseBodyKind: parsedResponse.kind,
      responseBody: responseBody.value,
      resourceType: entry.resourceType,
      initiator: entry.initiator,
      frameId: entry.frameId,
      documentUrl: entry.documentUrl,
      graphql,
      sensitiveRequestHeaders,
      redactionCount:
        urlResult.redactions.length +
        requestHeaders.redactions.length +
        responseHeaders.redactions.length +
        requestBody.redactions.length +
        responseBody.redactions.length,
    };

    this.emitted += 1;
    sink.network(observation);
  }
}
