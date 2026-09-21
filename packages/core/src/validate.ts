import type { JsonSchema, JsonSchemaType } from './json-schema.js';

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: ValidationIssue[];
}

function actualType(value: unknown): JsonSchemaType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'boolean':
      return 'boolean';
    case 'number':
      return Number.isInteger(value) ? 'integer' : 'number';
    default:
      return 'object';
  }
}

function typeMatches(expected: JsonSchemaType, value: unknown): boolean {
  const actual = actualType(value);
  if (expected === actual) return true;
  // An integer is a valid number; the reverse is not true.
  if (expected === 'number' && actual === 'integer') return true;
  return false;
}

/**
 * Validates a value against the JSON Schema subset GhostAPI emits.
 *
 * Hand-written rather than pulled from a library because the subset is small,
 * the error messages need to be user-facing, and an operation schema is
 * partly derived from an untrusted page — a smaller validator is a smaller
 * thing to be wrong about.
 */
export function validateAgainstSchema(
  value: unknown,
  schema: JsonSchema,
  path = '',
): ValidationResult {
  const issues: ValidationIssue[] = [];
  walk(value, schema, path || '$', issues);
  return { valid: issues.length === 0, issues };
}

function walk(value: unknown, schema: JsonSchema, path: string, issues: ValidationIssue[]): void {
  if (Object.keys(schema).length === 0) return;

  if (value === null) {
    const allowsNull =
      schema.nullable === true ||
      schema.type === 'null' ||
      (Array.isArray(schema.type) && schema.type.includes('null'));
    if (!allowsNull) issues.push({ path, message: 'must not be null' });
    return;
  }

  if (schema.type !== undefined) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expected.some((type) => typeMatches(type, value))) {
      issues.push({
        path,
        message: `expected ${expected.join(' or ')}, received ${actualType(value)}`,
      });
      return;
    }
  }

  if (schema.enum && !schema.enum.some((option) => option === value)) {
    issues.push({
      path,
      message: `must be one of ${schema.enum.map((option) => JSON.stringify(option)).join(', ')}`,
    });
    return;
  }

  if (Array.isArray(value)) {
    if (schema.items) {
      value.forEach((item, index) => walk(item, schema.items as JsonSchema, `${path}[${index}]`, issues));
    }
    return;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (record[key] === undefined) {
        issues.push({ path: path === '$' ? key : `${path}.${key}`, message: 'is required' });
      }
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(record)) {
        if (!(key in schema.properties)) {
          issues.push({
            path: path === '$' ? key : `${path}.${key}`,
            message: 'is not an input of this operation',
          });
        }
      }
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      const childValue = record[key];
      if (childValue === undefined) continue;
      walk(childValue, child, path === '$' ? key : `${path}.${key}`, issues);
    }
  }
}

export function formatIssues(issues: readonly ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path} ${issue.message}`).join('; ');
}
