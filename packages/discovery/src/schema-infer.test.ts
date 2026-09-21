import { describe, expect, it } from 'vitest';
import { REDACTED } from '@ghostapi/core';
import { inferSchema, mergeSchemas, pickProperties } from './schema-infer.js';

describe('inferSchema', () => {
  it('marks a field optional only when a sample is missing it', () => {
    const schema = inferSchema([{ title: 'a', notes: 'x' }, { title: 'b' }, { title: 'c' }]);
    expect(schema.required).toEqual(['title']);
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(['notes', 'title']);
  });

  it('does not invent an enum from a single sample', () => {
    const schema = inferSchema([{ priority: 'high' }]);
    expect(schema.properties?.priority?.enum).toBeUndefined();
    expect(schema.properties?.priority?.type).toBe('string');
  });

  it('does not invent an enum when every sample is distinct', () => {
    const schema = inferSchema([{ p: 'a' }, { p: 'b' }, { p: 'c' }]);
    expect(schema.properties?.p?.enum).toBeUndefined();
  });

  it('infers an enum once values repeat across enough samples', () => {
    const schema = inferSchema([
      { priority: 'high' },
      { priority: 'low' },
      { priority: 'high' },
      { priority: 'normal' },
      { priority: 'low' },
    ]);
    expect(schema.properties?.priority?.enum).toEqual(['high', 'low', 'normal']);
  });

  it('uses the most frequently observed enum member as the example', () => {
    const schema = inferSchema([
      { p: 'high' },
      { p: 'high' },
      { p: 'high' },
      { p: 'low' },
      { p: 'normal' },
    ]);
    expect(schema.properties?.p?.examples).toEqual(['high']);
  });

  it('recognises common string formats', () => {
    expect(inferSchema(['2026-09-21T10:00:00Z', '2025-01-02T03:04:05Z']).format).toBe('date-time');
    expect(inferSchema(['a@b.com', 'c@d.org']).format).toBe('email');
    expect(
      inferSchema(['3f1a9e2b-1c2d-4e5f-8a9b-0c1d2e3f4a5b', '4f1a9e2b-1c2d-4e5f-8a9b-0c1d2e3f4a5c'])
        .format,
    ).toBe('uuid');
  });

  it('marks a field nullable when null was observed alongside a value', () => {
    const schema = inferSchema([{ notes: null }, { notes: 'x' }]);
    expect(schema.properties?.notes?.nullable).toBe(true);
    expect(schema.properties?.notes?.type).toBe('string');
  });

  it('collapses integer and number into one numeric type', () => {
    expect(inferSchema([1, 2.5]).type).toBe('number');
    expect(inferSchema([1, 2]).type).toBe('integer');
  });

  it('recurses into nested objects and arrays', () => {
    const schema = inferSchema([
      { user: { id: 1, tags: ['a'] } },
      { user: { id: 2, tags: ['b', 'c'] } },
    ]);
    expect(schema.properties?.user?.properties?.id?.type).toBe('integer');
    expect(schema.properties?.user?.properties?.tags?.items?.type).toBe('string');
  });

  it('keeps a redacted leaf typed without leaking it into an enum or example', () => {
    const schema = inferSchema([
      { password: REDACTED },
      { password: REDACTED },
      { password: REDACTED },
    ]);
    const child = schema.properties?.password;
    expect(child?.type).toBe('string');
    expect(child?.enum).toBeUndefined();
    expect(JSON.stringify(child)).not.toContain('"examples"');
  });

  it('returns an empty schema when it has seen nothing', () => {
    expect(inferSchema([])).toEqual({});
  });
});

describe('mergeSchemas', () => {
  it('keeps a field required only if both sides required it', () => {
    const a = inferSchema([{ x: 1, y: 2 }]);
    const b = inferSchema([{ x: 1 }]);
    expect(mergeSchemas(a, b).required).toEqual(['x']);
  });

  it('unions enum members', () => {
    const merged = mergeSchemas(
      { type: 'string', enum: ['a', 'b'] },
      { type: 'string', enum: ['b', 'c'] },
    );
    expect(merged.enum).toEqual(['a', 'b', 'c']);
  });
});

describe('pickProperties', () => {
  it('narrows to the named properties and keeps their requiredness', () => {
    const schema = inferSchema([{ a: 1, b: 2, c: 3 }]);
    const picked = pickProperties(schema, ['a', 'c']);
    expect(Object.keys(picked.properties ?? {})).toEqual(['a', 'c']);
    expect(picked.required).toEqual(['a', 'c']);
  });
});
