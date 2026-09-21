import { describe, expect, it } from 'vitest';
import { fillUrlTemplate, resolveBinding } from './binding.js';

describe('resolveBinding', () => {
  it('reads a literal', () => {
    expect(resolveBinding({ kind: 'literal', value: 'x' }, {})).toBe('x');
  });

  it('reads an input', () => {
    expect(resolveBinding({ kind: 'input', field: 'title' }, { title: 'Buy milk' })).toBe('Buy milk');
  });

  it('omits absent optional inputs rather than sending null', () => {
    const result = resolveBinding(
      {
        kind: 'object',
        properties: {
          title: { kind: 'input', field: 'title' },
          notes: { kind: 'input', field: 'notes' },
        },
      },
      { title: 'x' },
    );
    expect(result).toEqual({ title: 'x' });
    expect(Object.keys(result as object)).not.toContain('notes');
  });

  it('keeps an explicit null, which is different from absent', () => {
    const result = resolveBinding(
      { kind: 'object', properties: { notes: { kind: 'input', field: 'notes' } } },
      { notes: null },
    );
    expect(result).toEqual({ notes: null });
  });

  it('walks nested objects and arrays', () => {
    const result = resolveBinding(
      {
        kind: 'object',
        properties: {
          user: { kind: 'object', properties: { id: { kind: 'input', field: 'id' } } },
          tags: { kind: 'array', items: [{ kind: 'literal', value: 'a' }, { kind: 'input', field: 'tag' }] },
        },
      },
      { id: 7, tag: 'b' },
    );
    expect(result).toEqual({ user: { id: 7 }, tags: ['a', 'b'] });
  });

  it('never interprets a value as a template or expression', () => {
    const result = resolveBinding(
      { kind: 'object', properties: { title: { kind: 'input', field: 'title' } } },
      { title: '${process.env.SECRET}' },
    );
    expect(result).toEqual({ title: '${process.env.SECRET}' });
  });
});

describe('fillUrlTemplate', () => {
  it('substitutes and encodes path parameters', () => {
    expect(fillUrlTemplate('https://x/api/todos/{todoId}', ['todoId'], { todoId: 'a b/c' })).toBe(
      'https://x/api/todos/a%20b%2Fc',
    );
  });

  it('refuses to build a URL with a missing parameter', () => {
    expect(() => fillUrlTemplate('https://x/api/todos/{todoId}', ['todoId'], {})).toThrow(/todoId/);
    expect(() => fillUrlTemplate('https://x/api/todos/{todoId}', ['todoId'], { todoId: '' })).toThrow();
  });

  it('refuses to leave an unresolved placeholder in the URL', () => {
    expect(() => fillUrlTemplate('https://x/api/{a}/{b}', ['a'], { a: '1' })).toThrow(/placeholder/i);
  });

  it('blocks path traversal through a parameter value', () => {
    const url = fillUrlTemplate('https://x/api/todos/{todoId}', ['todoId'], { todoId: '../../admin' });
    expect(url).toBe('https://x/api/todos/..%2F..%2Fadmin');
    expect(new URL(url).pathname).toBe('/api/todos/..%2F..%2Fadmin');
  });
});
