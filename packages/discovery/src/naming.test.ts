import { describe, expect, it } from 'vitest';
import { analyzeEndpoint, nameGraphqlOperation, nameOperation, uniqueName } from './naming.js';
import { inferPathTemplate } from './path-template.js';

const anatomyOf = (paths: string[]) => analyzeEndpoint(inferPathTemplate(paths));

describe('analyzeEndpoint', () => {
  it('reads a collection', () => {
    expect(anatomyOf(['/api/todos'])).toEqual({ shape: 'collection', entity: 'todo' });
  });

  it('reads an item', () => {
    expect(anatomyOf(['/api/todos/a1', '/api/todos/b2'])).toEqual({ shape: 'item', entity: 'todo' });
  });

  it('reads an action on an item', () => {
    expect(anatomyOf(['/api/todos/a1/archive', '/api/todos/b2/archive'])).toEqual({
      shape: 'action',
      entity: 'todo',
      action: 'archive',
    });
  });

  it('ignores api and version prefixes', () => {
    expect(anatomyOf(['/v2/projects']).entity).toBe('project');
    expect(anatomyOf(['/rest/v1/categories']).entity).toBe('category');
  });
});

describe('nameOperation', () => {
  const cases: [string, Parameters<typeof nameOperation>[0], string, string][] = [
    ['create', { method: 'POST', anatomy: anatomyOf(['/api/todos']), queryKeys: [], hasRequestBody: true }, 'createTodo', 'create'],
    ['list', { method: 'GET', anatomy: anatomyOf(['/api/todos']), queryKeys: [], hasRequestBody: false }, 'listTodos', 'list'],
    ['search', { method: 'GET', anatomy: anatomyOf(['/api/todos']), queryKeys: ['query'], hasRequestBody: false }, 'searchTodos', 'search'],
    ['read', { method: 'GET', anatomy: anatomyOf(['/api/todos/a1', '/api/todos/b2']), queryKeys: [], hasRequestBody: false }, 'getTodo', 'read'],
    ['update', { method: 'PATCH', anatomy: anatomyOf(['/api/todos/a1', '/api/todos/b2']), queryKeys: [], hasRequestBody: true }, 'updateTodo', 'update'],
    ['delete', { method: 'DELETE', anatomy: anatomyOf(['/api/todos/a1', '/api/todos/b2']), queryKeys: [], hasRequestBody: false }, 'deleteTodo', 'delete'],
    ['archive', { method: 'POST', anatomy: anatomyOf(['/api/todos/a1/archive', '/api/todos/b2/archive']), queryKeys: [], hasRequestBody: false }, 'archiveTodo', 'archive'],
  ];

  for (const [label, input, expectedName, expectedVerb] of cases) {
    it(`derives ${expectedName} for ${label}`, () => {
      const result = nameOperation(input);
      expect(result.name).toBe(expectedName);
      expect(result.verb).toBe(expectedVerb);
    });
  }

  it('never produces a method-and-path name', () => {
    const result = nameOperation({
      method: 'POST',
      anatomy: anatomyOf(['/api/todos']),
      queryKeys: [],
      hasRequestBody: true,
    });
    expect(result.name).not.toMatch(/^post/i);
    expect(result.name).not.toMatch(/api/i);
  });

  it('pluralises irregular entities correctly', () => {
    expect(
      nameOperation({ method: 'GET', anatomy: anatomyOf(['/api/categories']), queryKeys: [], hasRequestBody: false })
        .name,
    ).toBe('listCategories');
  });

  it('recognises a session endpoint as sign in and sign out', () => {
    const anatomy = anatomyOf(['/api/session']);
    expect(nameOperation({ method: 'POST', anatomy, queryKeys: [], hasRequestBody: true }).name).toBe('signIn');
    expect(nameOperation({ method: 'DELETE', anatomy, queryKeys: [], hasRequestBody: false }).name).toBe('signOut');
  });

  it('produces valid camelCase identifiers', () => {
    for (const [, input] of cases.map((entry) => [entry[0], entry[1]] as const)) {
      expect(nameOperation(input).name).toMatch(/^[a-z][A-Za-z0-9]*$/);
    }
  });
});

describe('nameGraphqlOperation', () => {
  it('reads the verb from the operation name', () => {
    expect(nameGraphqlOperation('createTag', 'mutation', undefined)).toEqual({
      name: 'createTag',
      verb: 'create',
      entity: 'tag',
    });
  });

  it('defaults a query with no recognised prefix to a read', () => {
    expect(nameGraphqlOperation('Projects', 'query', undefined).verb).toBe('read');
  });
});

describe('uniqueName', () => {
  it('suffixes a collision rather than overwriting', () => {
    expect(uniqueName('createTodo', new Set(['createTodo']))).toBe('createTodo2');
    expect(uniqueName('createTodo', new Set(['createTodo', 'createTodo2']))).toBe('createTodo3');
  });
});
