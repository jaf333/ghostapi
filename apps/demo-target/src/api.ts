import { randomUUID } from 'node:crypto';
import type { Database, Priority, Todo } from './data.js';

export interface ApiRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  sessionId: string | undefined;
}

export interface ApiResponse {
  status: number;
  body: unknown;
  setCookie?: string;
  clearCookie?: boolean;
}

const PRIORITIES: Priority[] = ['low', 'normal', 'high'];

function badRequest(message: string, field?: string): ApiResponse {
  return { status: 400, body: { error: message, field } };
}

function requireUser(db: Database, sessionId: string | undefined) {
  if (!sessionId) return undefined;
  const email = db.sessions.get(sessionId);
  return email ? db.users.get(email) : undefined;
}

function publicTodo(todo: Todo): Todo {
  return { ...todo };
}

function asObject(body: unknown): Record<string, unknown> | undefined {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : undefined;
}

export function handleApi(db: Database, request: ApiRequest): ApiResponse {
  const { method, path } = request;

  if (path === '/api/session') {
    if (method === 'POST') return login(db, request);
    if (method === 'DELETE') return logout(db, request);
    if (method === 'GET') {
      const user = requireUser(db, request.sessionId);
      if (!user) return { status: 401, body: { error: 'Not authenticated' } };
      return { status: 200, body: { user: { id: user.id, email: user.email, name: user.name } } };
    }
    return { status: 405, body: { error: 'Method not allowed' } };
  }

  if (path === '/api/events' && method === 'POST') {
    const payload = asObject(request.body);
    db.events.push({ name: String(payload?.name ?? 'unknown'), at: new Date().toISOString() });
    return { status: 202, body: { ok: true } };
  }

  const user = requireUser(db, request.sessionId);
  if (!user) {
    return { status: 401, body: { error: 'Not authenticated', detail: 'Sign in to continue.' } };
  }

  if (path === '/api/projects' && method === 'GET') {
    return { status: 200, body: { projects: db.projects } };
  }

  if (path === '/api/todos') {
    if (method === 'GET') return listTodos(db, request);
    if (method === 'POST') return createTodo(db, request);
    return { status: 405, body: { error: 'Method not allowed' } };
  }

  const archiveMatch = /^\/api\/todos\/([\w-]+)\/archive$/.exec(path);
  if (archiveMatch && method === 'POST') {
    return archiveTodo(db, archiveMatch[1] as string);
  }

  const todoMatch = /^\/api\/todos\/([\w-]+)$/.exec(path);
  if (todoMatch) {
    const id = todoMatch[1] as string;
    if (method === 'GET') return readTodo(db, id);
    if (method === 'PATCH') return updateTodo(db, id, request);
    if (method === 'DELETE') return deleteTodo(db, id);
    return { status: 405, body: { error: 'Method not allowed' } };
  }

  if (path === '/api/__reset' && method === 'POST') {
    return { status: 200, body: { ok: true } };
  }

  return { status: 404, body: { error: 'Not found', path } };
}

function login(db: Database, request: ApiRequest): ApiResponse {
  const payload = asObject(request.body);
  const email = typeof payload?.email === 'string' ? payload.email : undefined;
  const password = typeof payload?.password === 'string' ? payload.password : undefined;
  if (!email || !password) return badRequest('email and password are required');
  const user = db.users.get(email);
  if (!user || user.password !== password) {
    return { status: 401, body: { error: 'Invalid credentials' } };
  }
  const sessionId = randomUUID();
  db.sessions.set(sessionId, email);
  return {
    status: 200,
    body: { user: { id: user.id, email: user.email, name: user.name } },
    setCookie: sessionId,
  };
}

function logout(db: Database, request: ApiRequest): ApiResponse {
  if (request.sessionId) db.sessions.delete(request.sessionId);
  return { status: 204, body: null, clearCookie: true };
}

function listTodos(db: Database, request: ApiRequest): ApiResponse {
  const query = request.query.get('query')?.toLowerCase() ?? '';
  const status = request.query.get('status') ?? 'active';
  const projectId = request.query.get('projectId');
  let todos = db.todos.filter((todo) => (status === 'archived' ? todo.archived : !todo.archived));
  if (status === 'all') todos = [...db.todos];
  if (projectId) todos = todos.filter((todo) => todo.projectId === projectId);
  if (query) {
    todos = todos.filter(
      (todo) =>
        todo.title.toLowerCase().includes(query) ||
        (todo.notes ?? '').toLowerCase().includes(query),
    );
  }
  return { status: 200, body: { todos: todos.map(publicTodo), total: todos.length } };
}

function createTodo(db: Database, request: ApiRequest): ApiResponse {
  const payload = asObject(request.body);
  const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
  if (title.length === 0) return badRequest('title is required', 'title');
  const projectId =
    typeof payload?.projectId === 'string' && payload.projectId.length > 0
      ? payload.projectId
      : 'prj_inbox';
  if (!db.projects.some((project) => project.id === projectId)) {
    return badRequest(`unknown projectId ${projectId}`, 'projectId');
  }
  const priorityValue = typeof payload?.priority === 'string' ? payload.priority : 'normal';
  if (!PRIORITIES.includes(priorityValue as Priority)) {
    return badRequest(`priority must be one of ${PRIORITIES.join(', ')}`, 'priority');
  }
  const now = new Date().toISOString();
  const todo: Todo = {
    id: `todo_${randomUUID().slice(0, 8)}`,
    title,
    notes: typeof payload?.notes === 'string' ? payload.notes : null,
    priority: priorityValue as Priority,
    projectId,
    done: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  db.todos.unshift(todo);
  return { status: 201, body: { todo: publicTodo(todo) } };
}

function readTodo(db: Database, id: string): ApiResponse {
  const todo = db.todos.find((item) => item.id === id);
  if (!todo) return { status: 404, body: { error: 'Todo not found', id } };
  return { status: 200, body: { todo: publicTodo(todo) } };
}

function updateTodo(db: Database, id: string, request: ApiRequest): ApiResponse {
  const index = db.todos.findIndex((item) => item.id === id);
  if (index === -1) return { status: 404, body: { error: 'Todo not found', id } };
  const current = db.todos[index] as Todo;
  const payload = asObject(request.body) ?? {};
  if (payload.priority !== undefined && !PRIORITIES.includes(payload.priority as Priority)) {
    return badRequest(`priority must be one of ${PRIORITIES.join(', ')}`, 'priority');
  }
  const next: Todo = {
    ...current,
    title: typeof payload.title === 'string' ? payload.title : current.title,
    notes:
      payload.notes === null || typeof payload.notes === 'string'
        ? (payload.notes as string | null)
        : current.notes,
    priority: (payload.priority as Priority | undefined) ?? current.priority,
    done: typeof payload.done === 'boolean' ? payload.done : current.done,
    updatedAt: new Date().toISOString(),
  };
  db.todos[index] = next;
  return { status: 200, body: { todo: publicTodo(next) } };
}

function archiveTodo(db: Database, id: string): ApiResponse {
  const index = db.todos.findIndex((item) => item.id === id);
  if (index === -1) return { status: 404, body: { error: 'Todo not found', id } };
  const next: Todo = {
    ...(db.todos[index] as Todo),
    archived: true,
    updatedAt: new Date().toISOString(),
  };
  db.todos[index] = next;
  return { status: 200, body: { todo: publicTodo(next) } };
}

function deleteTodo(db: Database, id: string): ApiResponse {
  const index = db.todos.findIndex((item) => item.id === id);
  if (index === -1) return { status: 404, body: { error: 'Todo not found', id } };
  db.todos.splice(index, 1);
  return { status: 204, body: null };
}
