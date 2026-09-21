import { check, fetchJson, pass, startTarget } from './lib.mjs';

const target = await startTarget();
try {
  const anonymous = await fetchJson(`${target.url}/api/todos`);
  check(anonymous.status === 401, `unauthenticated todo listing returned ${anonymous.status}, expected 401`);

  const badLogin = await fetchJson(`${target.url}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'demo@ghostapi.dev', password: 'wrong' }),
  });
  check(badLogin.status === 401, `a wrong password returned ${badLogin.status}, expected 401`);

  const login = await fetch(`${target.url}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'demo@ghostapi.dev', password: 'ghost' }),
  });
  check(login.status === 200, `login returned ${login.status}`);
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  check(Boolean(cookie), 'login set no session cookie');

  const auth = { cookie, 'content-type': 'application/json' };

  const created = await fetchJson(`${target.url}/api/todos`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ title: 'Gate todo', projectId: 'prj_home', priority: 'high' }),
  });
  check(created.status === 201, `create returned ${created.status}, expected 201`);
  const id = created.body.todo.id;
  check(typeof id === 'string' && id.length > 0, 'create returned no id');

  const invalid = await fetchJson(`${target.url}/api/todos`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ title: 'x', priority: 'urgent' }),
  });
  check(invalid.status === 400, `an invalid priority returned ${invalid.status}, expected 400`);

  const searched = await fetchJson(`${target.url}/api/todos?query=gate`, { headers: auth });
  check(searched.body.total === 1, `search found ${searched.body.total} todos, expected 1`);

  const updated = await fetchJson(`${target.url}/api/todos/${id}`, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({ title: 'Gate todo renamed' }),
  });
  check(updated.body.todo.title === 'Gate todo renamed', 'update did not change the title');

  const archived = await fetchJson(`${target.url}/api/todos/${id}/archive`, {
    method: 'POST',
    headers: auth,
  });
  check(archived.body.todo.archived === true, 'archive did not archive the todo');

  const graphqlAnonymous = await fetchJson(`${target.url}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'query { projects { id } }' }),
  });
  check(graphqlAnonymous.status === 401, 'the GraphQL endpoint does not require a session');

  const graphql = await fetchJson(`${target.url}/graphql`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ query: 'query Projects { projects { id name } }' }),
  });
  check(Array.isArray(graphql.body.data.projects), 'the GraphQL endpoint returned no projects');

  const deleted = await fetch(`${target.url}/api/todos/${id}`, { method: 'DELETE', headers: auth });
  check(deleted.status === 204, `delete returned ${deleted.status}, expected 204`);

  const page = await fetch(target.url);
  const html = await page.text();
  check(page.status === 200 && html.includes('<title>Tasklet'), 'the target does not serve its UI');
  check(html.includes('app.js'), 'the target UI loads no client script');

  pass('GATE_G3_TARGET_OK');
} finally {
  await target.stop();
}
