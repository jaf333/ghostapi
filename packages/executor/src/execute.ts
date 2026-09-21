import {
  assertSafeUrl,
  DEFAULT_URL_POLICY,
  ErrorCodes,
  formatIssues,
  GhostError,
  requiresConfirmation,
  TraceRecorder,
  transportChain,
  validateAgainstSchema,
  type BrowserStep,
  type BrowserTransport,
  type GraphQLTransport,
  type HeaderBinding,
  type HttpTransport,
  type Operation,
  type Trace,
  type Transport,
  type TransportType,
  type UrlPolicy,
} from '@ghostapi/core';
import { fillUrlTemplate, resolveBinding } from './binding.js';
import { cookiesForUrl, resolveAuth, type AuthMaterial } from './auth-context.js';

export interface BrowserRunner {
  run(
    transport: BrowserTransport,
    inputs: Record<string, unknown>,
  ): Promise<{
    extracted: Record<string, string>;
    finalUrl: string;
  }>;
}

export interface ExecuteOptions {
  readonly operation: Operation;
  readonly inputs: Record<string, unknown>;
  readonly auth: AuthMaterial;
  /** Skips the destructive-operation gate. Set only from an explicit --yes. */
  readonly confirmed?: boolean;
  /** Needed only when a browser transport is reached. */
  readonly browser?: BrowserRunner;
  readonly urlPolicy?: UrlPolicy;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  /** Restricts execution to one transport, used by the benchmark. */
  readonly forceTransport?: TransportType;
}

export interface ExecutionAttempt {
  readonly transport: TransportType;
  readonly ok: boolean;
  readonly error?: string;
}

export interface ExecutionResult {
  readonly ok: boolean;
  readonly operation: string;
  readonly transport: TransportType;
  readonly status?: number;
  readonly data: unknown;
  readonly requestSummary: string;
  readonly latencyMs: number;
  readonly attempts: ExecutionAttempt[];
  readonly authDescription: string;
  readonly trace: Trace;
}

const DEFAULT_TIMEOUT_MS = 20_000;

function headerValue(
  binding: HeaderBinding,
  inputs: Record<string, unknown>,
  env: Record<string, string | undefined>,
): string | undefined {
  switch (binding.kind) {
    case 'literal':
      return binding.value;
    case 'input': {
      const value = inputs[binding.field];
      return value === undefined ? undefined : String(value);
    }
    case 'env': {
      const value = env[binding.env];
      return value === undefined ? undefined : `${binding.prefix ?? ''}${value}`;
    }
    case 'session':
      return undefined;
  }
}

export interface PreparedHttpRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
}

/** Builds the exact request an operation would send, without sending it. */
export function prepareHttpRequest(
  transport: HttpTransport,
  inputs: Record<string, unknown>,
  auth: AuthMaterial,
  strategy: Operation['auth'],
  policy: UrlPolicy = DEFAULT_URL_POLICY,
): { request: PreparedHttpRequest; authDescription: string } {
  const base = fillUrlTemplate(transport.urlTemplate, transport.pathParams, inputs);
  const url = new URL(base);
  for (const [key, binding] of Object.entries(transport.query)) {
    const value = resolveBinding(binding, inputs);
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  assertSafeUrl(url.toString(), policy);

  const env = auth.env ?? process.env;
  const headers: Record<string, string> = {};
  for (const [name, binding] of Object.entries(transport.headers)) {
    const value = headerValue(binding, inputs, env);
    if (value !== undefined) headers[name.toLowerCase()] = value;
  }

  const resolvedAuth = resolveAuth(strategy, {
    ...auth,
    cookies: auth.cookies ? cookiesForUrl(auth.cookies, url.toString()) : undefined,
  });
  Object.assign(headers, resolvedAuth.headers);

  let body: string | undefined;
  if (transport.body && transport.bodyKind !== 'none') {
    const value = resolveBinding(transport.body, inputs);
    if (transport.bodyKind === 'json') {
      body = JSON.stringify(value);
      headers['content-type'] ??= 'application/json';
    } else if (transport.bodyKind === 'form') {
      const record = (value ?? {}) as Record<string, unknown>;
      const pairs: [string, string][] = Object.entries(record).map(([key, item]) => [
        key,
        String(item),
      ]);
      body = new URLSearchParams(pairs).toString();
      headers['content-type'] ??= 'application/x-www-form-urlencoded';
    } else {
      body = typeof value === 'string' ? value : JSON.stringify(value);
    }
  }

  return {
    request: { url: url.toString(), method: transport.method, headers, body },
    authDescription: resolvedAuth.description,
  };
}

async function runHttp(
  transport: HttpTransport,
  options: ExecuteOptions,
  trace: TraceRecorder,
): Promise<{ status: number; data: unknown; summary: string; authDescription: string }> {
  const { request, authDescription } = prepareHttpRequest(
    transport,
    options.inputs,
    options.auth,
    options.operation.auth,
    options.urlPolicy,
  );
  const summary = `${request.method} ${request.url}`;
  trace.event('request.prepared', {
    method: request.method,
    url: request.url,
    headerNames: Object.keys(request.headers).sort(),
  });

  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await response.text();
    const contentType = response.headers.get('content-type') ?? '';
    let data: unknown = text.length === 0 ? null : text;
    if (contentType.includes('json') && text.length > 0) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    trace.event('response.received', { status: response.status, bytes: text.length });

    if (!response.ok) {
      throw httpFailure(options.operation, summary, response.status, data);
    }
    return { status: response.status, data, summary, authDescription };
  } finally {
    clearTimeout(timeout);
  }
}

function httpFailure(
  operation: Operation,
  summary: string,
  status: number,
  data: unknown,
): GhostError {
  const isAuth = status === 401 || status === 403;
  const detail =
    typeof data === 'object' && data !== null
      ? JSON.stringify(data).slice(0, 400)
      : String(data ?? '').slice(0, 400);
  return new GhostError({
    code: isAuth ? ErrorCodes.AuthExpired : ErrorCodes.ExecutionFailed,
    title: 'Operation execution failed',
    detail: `${summary} returned ${status}.${detail ? ` Response: ${detail}` : ''}`,
    remedy: isAuth
      ? 'The session used to derive this operation has expired.\n\nRun:\n  ghostapi open <url>\n\nand authenticate again.'
      : `Run \`ghostapi inspect ${operation.name}\` to review the request this operation builds.`,
    context: { status, operation: operation.name },
  });
}

async function runGraphql(
  transport: GraphQLTransport,
  options: ExecuteOptions,
  trace: TraceRecorder,
): Promise<{ status: number; data: unknown; summary: string; authDescription: string }> {
  const variables: Record<string, unknown> = {};
  for (const [key, binding] of Object.entries(transport.variables)) {
    const value = resolveBinding(binding, options.inputs);
    if (value !== undefined) variables[key] = value;
  }
  const httpTransport: HttpTransport = {
    type: 'http',
    method: 'POST',
    urlTemplate: transport.endpoint,
    pathParams: [],
    query: {},
    headers: transport.headers,
    bodyKind: 'json',
    body: {
      kind: 'object',
      properties: {
        query: { kind: 'literal', value: transport.document },
        ...(transport.operationName
          ? { operationName: { kind: 'literal' as const, value: transport.operationName } }
          : {}),
        variables: { kind: 'literal', value: variables },
      },
    },
    successStatuses: [200],
  };
  const result = await runHttp(httpTransport, { ...options, inputs: {} }, trace);
  const payload = result.data as { errors?: { message?: string }[] } | null;
  if (payload && Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new GhostError({
      code: ErrorCodes.ExecutionFailed,
      title: 'GraphQL operation returned errors',
      detail: payload.errors.map((error) => error.message ?? 'unknown error').join('; '),
      remedy: `Run \`ghostapi inspect ${options.operation.name}\` to review the document and variables.`,
    });
  }
  return {
    ...result,
    summary: `GraphQL ${transport.operationName ?? 'operation'} → ${transport.endpoint}`,
  };
}

async function runBrowser(
  transport: BrowserTransport,
  options: ExecuteOptions,
  trace: TraceRecorder,
): Promise<{ status: number; data: unknown; summary: string; authDescription: string }> {
  if (!options.browser) {
    throw new GhostError({
      code: ErrorCodes.TransportUnsupported,
      title: 'Browser fallback unavailable',
      detail:
        'This operation can only run through the browser, but no browser runner was provided.',
      remedy: 'Run this operation through the CLI, which can start a browser session.',
    });
  }
  const steps: readonly BrowserStep[] = transport.steps;
  trace.event('browser.start', { startUrl: transport.startUrl, steps: steps.length });
  const result = await options.browser.run(transport, options.inputs);
  return {
    status: 200,
    data: { finalUrl: result.finalUrl, extracted: result.extracted },
    summary: `browser: ${steps.length} step(s) from ${transport.startUrl}`,
    authDescription: 'browser session',
  };
}

async function runTransport(
  transport: Transport,
  options: ExecuteOptions,
  trace: TraceRecorder,
): Promise<{ status: number; data: unknown; summary: string; authDescription: string }> {
  switch (transport.type) {
    case 'http':
      return runHttp(transport, options, trace);
    case 'graphql':
      return runGraphql(transport, options, trace);
    case 'browser':
      return runBrowser(transport, options, trace);
    case 'webmcp':
      throw new GhostError({
        code: ErrorCodes.TransportUnsupported,
        title: 'WebMCP transport not executable yet',
        detail:
          'GhostAPI records WebMCP tools during discovery but does not invoke them in this release.',
        remedy: 'Use the HTTP transport or the browser fallback for this operation.',
      });
  }
}

/**
 * Runs one operation.
 *
 * Transports are tried in preference order — API first, browser last — so an
 * operation degrades instead of failing. Every step lands in a trace, because
 * an execution you cannot explain is an execution you cannot trust.
 */
export async function executeOperation(options: ExecuteOptions): Promise<ExecutionResult> {
  const { operation } = options;
  const trace = new TraceRecorder({ operation: operation.name, entity: operation.entity ?? '' });
  const startedAt = Date.now();

  const confirmation = requiresConfirmation(operation, { yes: options.confirmed === true });
  if (confirmation) {
    throw new GhostError({
      code: ErrorCodes.ConfirmationRequired,
      title: 'Confirmation required',
      detail: `${confirmation.summary} (${confirmation.reason})`,
      remedy: `Re-run with --yes to proceed:\n\n  ghostapi run ${operation.name} '<json>' --yes`,
      context: { operation: operation.name },
    });
  }

  const validation = validateAgainstSchema(options.inputs, operation.inputs);
  if (!validation.valid) {
    throw new GhostError({
      code: ErrorCodes.InvalidInput,
      title: 'Invalid operation input',
      detail: formatIssues(validation.issues),
      remedy: `Run \`ghostapi inspect ${operation.name}\` to see the expected inputs.`,
      context: { issues: validation.issues },
    });
  }
  trace.event('input.validated', { fields: Object.keys(options.inputs).sort() });

  const chain = transportChain(operation).filter(
    (transport) => !options.forceTransport || transport.type === options.forceTransport,
  );
  if (chain.length === 0) {
    throw new GhostError({
      code: ErrorCodes.TransportUnsupported,
      title: 'No matching transport',
      detail: `${operation.name} has no ${options.forceTransport ?? 'usable'} transport.`,
      remedy: 'Run `ghostapi inspect` to see which transports this operation supports.',
    });
  }

  const attempts: ExecutionAttempt[] = [];
  // The preferred transport's failure is the one worth reporting. A browser
  // fallback that was never configured is a consequence, not the cause.
  let primaryError: unknown;

  for (const transport of chain) {
    try {
      const outcome = await trace.span(`execute.${transport.type}`, () =>
        runTransport(transport, options, trace),
      );
      attempts.push({ transport: transport.type, ok: true });
      return {
        ok: true,
        operation: operation.name,
        transport: transport.type,
        status: outcome.status,
        data: outcome.data,
        requestSummary: outcome.summary,
        latencyMs: Date.now() - startedAt,
        attempts,
        authDescription: outcome.authDescription,
        trace: trace.snapshot(),
      };
    } catch (error) {
      attempts.push({
        transport: transport.type,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      primaryError ??= error;
      // An input or confirmation problem will not be fixed by another transport.
      if (
        error instanceof GhostError &&
        (error.code === ErrorCodes.InvalidInput || error.code === ErrorCodes.ConfirmationRequired)
      ) {
        break;
      }
    }
  }

  if (primaryError instanceof GhostError && attempts.length > 1) {
    throw new GhostError(
      {
        code: primaryError.code,
        title: primaryError.title,
        detail: primaryError.detail,
        remedy: primaryError.remedy,
        context: { ...primaryError.context, attempts },
      },
      { cause: primaryError },
    );
  }
  throw primaryError instanceof Error
    ? primaryError
    : new GhostError({
        code: ErrorCodes.ExecutionFailed,
        title: 'Operation execution failed',
        detail: `${operation.name} failed on every available transport.`,
        remedy: `Run \`ghostapi inspect ${operation.name}\` to review its transports.`,
      });
}
