import { describe, expect, it } from 'vitest';
import { bodyKindFor, detectGraphql, looksStatic, parseBody } from './body.js';

describe('bodyKindFor', () => {
  it('reads the declared content type', () => {
    expect(bodyKindFor('application/json; charset=utf-8', '{}')).toBe('json');
    expect(bodyKindFor('application/vnd.api+json', '{}')).toBe('json');
    expect(bodyKindFor('application/x-www-form-urlencoded', 'a=1')).toBe('form');
    expect(bodyKindFor('text/html', '<p>')).toBe('text');
    expect(bodyKindFor('image/png', 'binarystuff')).toBe('binary');
  });

  it('falls back to the payload shape when the type is missing', () => {
    expect(bodyKindFor(undefined, '{"a":1}')).toBe('json');
    expect(bodyKindFor(undefined, 'hello')).toBe('text');
  });

  it('reports none for an empty body', () => {
    expect(bodyKindFor('application/json', undefined)).toBe('none');
    expect(bodyKindFor('application/json', '')).toBe('none');
  });
});

describe('parseBody', () => {
  it('parses JSON', () => {
    expect(parseBody('json', '{"a":1}')).toEqual({ kind: 'json', value: { a: 1 } });
  });

  it('degrades to text when JSON does not parse', () => {
    expect(parseBody('json', '{oops').kind).toBe('text');
  });

  it('parses form encoding into an object', () => {
    expect(parseBody('form', 'a=1&b=two')).toEqual({ kind: 'form', value: { a: '1', b: 'two' } });
  });

  it('summarises a binary body instead of keeping it', () => {
    expect(parseBody('binary', 'x'.repeat(100)).value).toBe('<100 bytes>');
  });
});

describe('detectGraphql', () => {
  it('recognises a GraphQL envelope wherever it is served from', () => {
    const envelope = detectGraphql({
      query: 'mutation createTag($name: String!) { createTag(name: $name) { id } }',
      variables: { name: 'bug' },
    });
    expect(envelope?.operationType).toBe('mutation');
    expect(envelope?.operationName).toBe('createTag');
  });

  it('prefers an explicit operationName', () => {
    expect(detectGraphql({ query: 'query { a }', operationName: 'Explicit' })?.operationName).toBe('Explicit');
  });

  it('ignores an ordinary body with a query field', () => {
    expect(detectGraphql({ query: 'milk' })).toBeUndefined();
    expect(detectGraphql({ title: 'x' })).toBeUndefined();
    expect(detectGraphql(null)).toBeUndefined();
  });
});

describe('looksStatic', () => {
  it('recognises asset paths', () => {
    for (const path of ['/app.js', '/main.css', '/logo.svg', '/f.woff2', '/x.map']) {
      expect(looksStatic(path), path).toBe(true);
    }
  });

  it('leaves API paths alone', () => {
    for (const path of ['/api/todos', '/graphql', '/api/todos/1']) {
      expect(looksStatic(path), path).toBe(false);
    }
  });
});
