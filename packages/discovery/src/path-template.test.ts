import { describe, expect, it } from 'vitest';
import { endpointKey, inferPathTemplate, looksLikeIdentifier, matchPath } from './path-template.js';
import { pathSkeleton } from './group.js';

describe('looksLikeIdentifier', () => {
  it('recognises the id shapes applications actually use', () => {
    expect(looksLikeIdentifier('3f1a9e2b-1c2d-4e5f-8a9b-0c1d2e3f4a5b')).toBe(true);
    expect(looksLikeIdentifier('42')).toBe(true);
    expect(looksLikeIdentifier('todo_9ab12c')).toBe(true);
    expect(looksLikeIdentifier('todo_1')).toBe(true);
    expect(looksLikeIdentifier('a3f19e2b7c4d8e1f')).toBe(true);
  });

  it('does not mistake route names for ids', () => {
    for (const segment of ['todos', 'api', 'archive', 'v1', 'search', 'user_profile', 'sign-out']) {
      expect(looksLikeIdentifier(segment), segment).toBe(false);
    }
  });
});

describe('inferPathTemplate', () => {
  it('templates a segment that varies between samples', () => {
    const template = inferPathTemplate(['/api/todos/abc', '/api/todos/def']);
    expect(template.template).toBe('/api/todos/{todoId}');
    expect(template.params).toEqual(['todoId']);
  });

  it('templates an id-shaped segment even from a single sample', () => {
    expect(inferPathTemplate(['/api/todos/todo_9ab12c']).template).toBe('/api/todos/{todoId}');
  });

  it('leaves a stable route segment alone', () => {
    expect(inferPathTemplate(['/api/todos', '/api/todos']).template).toBe('/api/todos');
  });

  it('handles an action after a parameter', () => {
    const template = inferPathTemplate(['/api/todos/a1b2c3d4/archive', '/api/todos/e5f6a7b8/archive']);
    expect(template.template).toBe('/api/todos/{todoId}/archive');
  });

  it('names parameters after the collection that precedes them', () => {
    expect(inferPathTemplate(['/api/projects/1', '/api/projects/2']).params).toEqual(['projectId']);
    expect(inferPathTemplate(['/api/categories/1', '/api/categories/2']).params).toEqual(['categoryId']);
  });

  it('matches a concrete path back to its parameters', () => {
    const template = inferPathTemplate(['/api/todos/abc', '/api/todos/def']);
    expect(matchPath(template, '/api/todos/xyz')).toEqual({ todoId: 'xyz' });
    expect(matchPath(template, '/api/projects/xyz')).toBeUndefined();
    expect(matchPath(template, '/api/todos/xyz/extra')).toBeUndefined();
  });
});

describe('pathSkeleton', () => {
  it('groups calls to the same route regardless of the id', () => {
    expect(pathSkeleton('/api/todos/todo_1')).toBe(pathSkeleton('/api/todos/todo_2'));
  });

  it('keeps different routes apart', () => {
    expect(pathSkeleton('/api/todos')).not.toBe(pathSkeleton('/api/projects'));
  });
});

describe('endpointKey', () => {
  it('separates methods on the same path', () => {
    expect(endpointKey('GET', '/api/todos', 'https://x')).not.toBe(
      endpointKey('POST', '/api/todos', 'https://x'),
    );
  });
});
