const $ = (id) => document.getElementById(id);

const state = { user: null, projects: [], todos: [] };

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'content-type': 'application/json' } : {},
    ...options,
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw Object.assign(new Error(body?.error ?? response.statusText), { body });
  return body;
}

function track(name) {
  // Analytics noise on purpose: GhostAPI must learn to ignore it.
  void fetch('/api/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, at: Date.now() }),
  }).catch(() => {});
}

function renderTodos() {
  const list = $('todo-list');
  list.replaceChildren();
  $('empty').hidden = state.todos.length > 0;
  for (const todo of state.todos) {
    const li = document.createElement('li');
    li.dataset.id = todo.id;
    if (todo.done) li.classList.add('done');

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = todo.done;
    toggle.setAttribute('aria-label', `Mark ${todo.title} done`);
    toggle.addEventListener('change', async () => {
      await api(`/api/todos/${todo.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ done: toggle.checked }),
      });
      track('todo_toggled');
      await refresh();
    });

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = todo.title;

    const priority = document.createElement('span');
    priority.className = 'tag';
    priority.textContent = todo.priority;

    const rename = document.createElement('button');
    rename.type = 'button';
    rename.textContent = 'Rename';
    rename.addEventListener('click', async () => {
      const next = `${todo.title} (edited)`;
      await api(`/api/todos/${todo.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: next }),
      });
      track('todo_renamed');
      await refresh();
    });

    const archive = document.createElement('button');
    archive.type = 'button';
    archive.textContent = 'Archive';
    archive.addEventListener('click', async () => {
      await api(`/api/todos/${todo.id}/archive`, { method: 'POST' });
      track('todo_archived');
      await refresh();
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Delete';
    remove.addEventListener('click', async () => {
      await api(`/api/todos/${todo.id}`, { method: 'DELETE' });
      track('todo_deleted');
      await refresh();
    });

    li.append(toggle, title, priority, rename, archive, remove);
    list.append(li);
  }
}

function renderProjects() {
  const select = $('new-project');
  select.replaceChildren();
  for (const project of state.projects) {
    const option = document.createElement('option');
    option.value = project.id;
    option.textContent = project.name;
    select.append(option);
  }
}

async function refresh() {
  const query = $('search-input').value.trim();
  const status = $('status-filter').value;
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  params.set('status', status);
  const data = await api(`/api/todos?${params.toString()}`);
  state.todos = data.todos;
  renderTodos();
}

function showApp() {
  $('login-view').hidden = true;
  $('app-view').hidden = false;
  $('who').textContent = state.user.email;
}

async function boot() {
  try {
    const session = await api('/api/session');
    state.user = session.user;
  } catch {
    $('login-view').hidden = false;
    return;
  }
  const projects = await api('/api/projects');
  state.projects = projects.projects;
  renderProjects();
  showApp();
  await refresh();
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('login-error').hidden = true;
  try {
    const result = await api('/api/session', {
      method: 'POST',
      body: JSON.stringify({ email: $('email').value, password: $('password').value }),
    });
    state.user = result.user;
    await boot();
  } catch (error) {
    $('login-error').textContent = error.message;
    $('login-error').hidden = false;
  }
});

$('logout').addEventListener('click', async () => {
  await api('/api/session', { method: 'DELETE' });
  location.reload();
});

$('create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = $('new-title').value.trim();
  if (!title) return;
  await api('/api/todos', {
    method: 'POST',
    body: JSON.stringify({
      title,
      projectId: $('new-project').value,
      priority: $('new-priority').value,
    }),
  });
  track('todo_created');
  $('new-title').value = '';
  await refresh();
});

$('search-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  track('todos_searched');
  await refresh();
});

boot().catch((error) => {
  document.body.append(Object.assign(document.createElement('pre'), { textContent: String(error) }));
});
