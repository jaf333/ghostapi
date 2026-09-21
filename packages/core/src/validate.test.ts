import { describe, expect, it } from 'vitest';
import { formatIssues, validateAgainstSchema } from './validate.js';
import type { JsonSchema } from './json-schema.js';

const schema: JsonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    priority: { type: 'string', enum: ['low', 'normal', 'high'] },
    count: { type: 'integer' },
    tags: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string', nullable: true },
  },
  required: ['title', 'priority'],
  additionalProperties: false,
};

describe('validateAgainstSchema', () => {
  it('accepts a valid input', () => {
    expect(validateAgainstSchema({ title: 'x', priority: 'low' }, schema).valid).toBe(true);
  });

  it('reports missing required fields by name', () => {
    const result = validateAgainstSchema({ title: 'x' }, schema);
    expect(result.valid).toBe(false);
    expect(formatIssues(result.issues)).toContain('priority is required');
  });

  it('rejects a value outside the enum', () => {
    const result = validateAgainstSchema({ title: 'x', priority: 'urgent' }, schema);
    expect(formatIssues(result.issues)).toMatch(/must be one of/);
  });

  it('rejects unknown inputs when additionalProperties is false', () => {
    const result = validateAgainstSchema({ title: 'x', priority: 'low', nope: 1 }, schema);
    expect(formatIssues(result.issues)).toContain('nope is not an input');
  });

  it('accepts an integer where a number is expected but not the reverse', () => {
    expect(validateAgainstSchema(1, { type: 'number' }).valid).toBe(true);
    expect(validateAgainstSchema(1.5, { type: 'integer' }).valid).toBe(false);
  });

  it('honours nullable', () => {
    expect(validateAgainstSchema({ title: 'x', priority: 'low', notes: null }, schema).valid).toBe(true);
    expect(validateAgainstSchema({ title: null, priority: 'low' }, schema).valid).toBe(false);
  });

  it('validates array items', () => {
    const bad = validateAgainstSchema({ title: 'x', priority: 'low', tags: ['a', 2] }, schema);
    expect(formatIssues(bad.issues)).toContain('tags[1]');
  });

  it('treats an empty schema as accepting anything', () => {
    expect(validateAgainstSchema({ anything: true }, {}).valid).toBe(true);
  });
});
