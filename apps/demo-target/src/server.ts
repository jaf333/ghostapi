import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi, type ApiResponse } from './api.js';
import { createDatabase, type Database } from './data.js';
import { handleGraphql } from './graphql.js';

// dist/public when built, ../public when running from source.
const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = existsSync(join(HERE, 'public'))
  ? join(HERE, 'public')
  : join(HERE, '..', 'public');
const COOKIE_NAME = 'demo_session';
const MAX_BODY_BYTES = 256 * 1024;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function parseCookies(header: string | undefined): Record<string, string> {
  const jar: Record<string, string> = {};
  if (!header) return jar;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    jar[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return jar;
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8');
  const contentType = request.headers['content-type'] ?? '';
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  return raw;
}

function sendJson(response: ServerResponse, result: ApiResponse): void {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  };
  if (result.setCookie) {
    headers['set-cookie'] = `${COOKIE_NAME}=${result.setCookie}; Path=/; HttpOnly; SameSite=Lax`;
  }
  if (result.clearCookie) {
    headers['set-cookie'] = `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }
  if (result.status === 204 || result.body === null) {
    response.writeHead(result.status, headers);
    response.end();
    return;
  }
  response.writeHead(result.status, headers);
  response.end(JSON.stringify(result.body));
}

async function serveStatic(pathname: string, response: ServerResponse): Promise<void> {
  const relative = pathname === '/' ? '/index.html' : pathname;
  const resolved = join(PUBLIC_DIR, normalize(relative).replace(/^(\.\.[/\\])+/, ''));
  if (!resolved.startsWith(PUBLIC_DIR)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const file = await readFile(resolved);
    response.writeHead(200, {
      'content-type': MIME[extname(resolved)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(file);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}

/** A start failure a person can act on, rather than a Node stack trace. */
export class PortInUseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortInUseError';
  }
}

export interface DemoServerHandle {
  readonly url: string;
  readonly port: number;
  close(): Promise<void>;
  reset(): void;
}

export async function startDemoTarget(
  port = Number(process.env.PORT ?? 4123),
): Promise<DemoServerHandle> {
  let db: Database = createDatabase();

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      const pathname = url.pathname;

      if (pathname === '/api/__reset' && request.method === 'POST') {
        db = createDatabase();
        sendJson(response, { status: 200, body: { ok: true } });
        return;
      }

      if (pathname === '/graphql' && request.method === 'POST') {
        const body = await readBody(request);
        const cookies = parseCookies(request.headers.cookie);
        if (!cookies[COOKIE_NAME] || !db.sessions.has(cookies[COOKIE_NAME] as string)) {
          sendJson(response, { status: 401, body: { errors: [{ message: 'Not authenticated' }] } });
          return;
        }
        const result = handleGraphql(db, (body ?? {}) as Record<string, unknown>);
        sendJson(response, { status: result.status, body: result.body });
        return;
      }

      if (pathname.startsWith('/api/')) {
        const body = await readBody(request);
        const cookies = parseCookies(request.headers.cookie);
        const result = handleApi(db, {
          method: request.method ?? 'GET',
          path: pathname,
          query: url.searchParams,
          body,
          sessionId: cookies[COOKIE_NAME],
        });
        sendJson(response, result);
        return;
      }

      await serveStatic(pathname, response);
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Internal error';
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json' });
      }
      response.end(JSON.stringify({ error: message }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        // A stack trace does not tell anyone what to do about a busy port.
        reject(
          new PortInUseError(
            `Port ${port} is already in use, so the demo target cannot start.\n\n` +
              `Something is already listening there — very likely an earlier demo target.\n\n` +
              `Find it:\n  lsof -nP -iTCP:${port} -sTCP:LISTEN\n\n` +
              `Stop it, or start this one on a different port:\n  PORT=4124 node apps/demo-target/dist/server.js\n\n` +
              `PORT=0 picks any free port and prints it.`,
          ),
        );
        return;
      }
      reject(error);
    });
    server.listen(port, '127.0.0.1', resolve);
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address !== null ? address.port : port;

  return {
    url: `http://127.0.0.1:${actualPort}`,
    port: actualPort,
    reset: () => {
      db = createDatabase();
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        // Keep-alive sockets keep `close` pending forever. Drop them first,
        // otherwise a caller that shuts this server down simply hangs.
        server.closeAllConnections?.();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const handle = await startDemoTarget().catch((error: unknown) => {
    if (error instanceof PortInUseError) {
      process.stderr.write(`\n${error.message}\n\n`);
      process.exit(1);
    }
    throw error;
  });
  process.stdout.write(`demo-target listening on ${handle.url}\n`);
  const shutdown = () => {
    // Exit even if a connection refuses to drain: a demo server that ignores
    // SIGTERM leaves every caller's process hanging on a live child handle.
    const force = setTimeout(() => process.exit(0), 2_000);
    force.unref();
    void handle
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
