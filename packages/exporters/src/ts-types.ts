import { assertSafeIdentifier, type JsonSchema, type Operation } from '@ghostapi/core';

function indent(level: number): string {
  return '  '.repeat(level);
}

function escapeString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Renders a JSON Schema as a TypeScript type literal. */
export function renderType(schema: JsonSchema, level = 0): string {
  if (schema.enum && schema.enum.length > 0) {
    return schema.enum
      .map((value) => (typeof value === 'string' ? `'${escapeString(value)}'` : String(value)))
      .join(' | ');
  }
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length === 0) return 'unknown';

  const rendered = types.map((type) => {
    switch (type) {
      case 'string':
        return 'string';
      case 'number':
      case 'integer':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'null':
        return 'null';
      case 'array':
        return `${renderType(schema.items ?? {}, level)}[]`;
      case 'object': {
        const properties = schema.properties ?? {};
        const keys = Object.keys(properties).sort();
        if (keys.length === 0) return 'Record<string, unknown>';
        const required = new Set(schema.required ?? []);
        const lines = keys.map((key) => {
          const child = properties[key] as JsonSchema;
          const optional = required.has(key) ? '' : '?';
          const doc = child.description ? `${indent(level + 1)}/** ${child.description} */\n` : '';
          const safeKey = /^[A-Za-z_$][\w$]*$/.test(key) ? key : `'${escapeString(key)}'`;
          return `${doc}${indent(level + 1)}${safeKey}${optional}: ${renderType(child, level + 1)};`;
        });
        return `{\n${lines.join('\n')}\n${indent(level)}}`;
      }
      default:
        return 'unknown';
    }
  });

  const union = [...new Set(rendered)].join(' | ');
  return schema.nullable && !union.includes('null') ? `${union} | null` : union;
}

export function inputTypeName(operation: Operation): string {
  const name = assertSafeIdentifier(operation.name, 'operation name');
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}Input`;
}

export function outputTypeName(operation: Operation): string {
  const name = assertSafeIdentifier(operation.name, 'operation name');
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}Output`;
}
