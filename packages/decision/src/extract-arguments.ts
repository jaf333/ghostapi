import type { JsonSchema, Operation } from '@ghostapi/core';

export type ArgumentSource = 'explicit' | 'phrase' | 'quoted' | 'enum' | 'observed-default';

export interface BoundArgument {
  readonly field: string;
  readonly value: unknown;
  readonly source: ArgumentSource;
  readonly note: string;
}

export interface ArgumentBinding {
  readonly inputs: Record<string, unknown>;
  readonly bound: BoundArgument[];
  readonly missing: string[];
}

/** Fields that usually carry the free-text the user actually said. */
const TEXT_FIELDS = [
  'title', 'name', 'label', 'query', 'q', 'search', 'text', 'subject', 'content', 'body',
  'message', 'description', 'summary', 'note', 'notes',
];

const PHRASE_PATTERNS: readonly RegExp[] = [
  /(?:called|named|titled|entitled)\s+(.+)$/i,
  /(?:rename|retitle|set)\s+.*?\s+to\s+(.+)$/i,
  /(?:about|containing|matching|for)\s+(.+)$/i,
  /(?:to say|saying)\s+(.+)$/i,
];

function cleanPhrase(value: string): string {
  return value
    .trim()
    .replace(/^["'“”‘’]|["'“”‘’]$/g, '')
    .replace(/[.!?]+$/, '')
    .trim();
}

function explicitAssignments(intent: string): Map<string, string> {
  const found = new Map<string, string>();
  const pattern = /([A-Za-z_][A-Za-z0-9_]*)\s*[=:]\s*("[^"]*"|'[^']*'|\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(intent)) !== null) {
    const key = match[1];
    const raw = match[2];
    if (key && raw) found.set(key, cleanPhrase(raw));
  }
  return found;
}

function quotedText(intent: string): string | undefined {
  const match = /["'“](.+?)["'”]/.exec(intent);
  return match?.[1]?.trim();
}

function phraseText(intent: string): string | undefined {
  for (const pattern of PHRASE_PATTERNS) {
    const match = pattern.exec(intent);
    const value = match?.[1];
    if (value) return cleanPhrase(value);
  }
  return undefined;
}

function coerce(schema: JsonSchema, raw: string): unknown {
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === 'number' || type === 'integer') {
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? raw : parsed;
  }
  if (type === 'boolean') return /^(true|yes|done|complete|on)$/i.test(raw);
  return raw;
}

function isPathParameter(schema: JsonSchema): boolean {
  return schema.description === 'path parameter';
}

/**
 * Turns a sentence into operation inputs, deterministically.
 *
 * Extraction is separated from routing on purpose. Routing is a small, closed
 * choice, which is what a decision model is good at; pulling "buy coffee" out
 * of a sentence is not a choice at all. Keeping them apart means the risky part
 * stays inspectable, and every value reports where it came from.
 */
export function extractArguments(intent: string, operation: Operation): ArgumentBinding {
  const schema = operation.inputs;
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const explicit = explicitAssignments(intent);
  const quoted = quotedText(intent);
  const phrase = phraseText(intent);

  const inputs: Record<string, unknown> = {};
  const bound: BoundArgument[] = [];
  let freeTextUsed = false;

  const assign = (field: string, value: unknown, source: ArgumentSource, note: string): void => {
    inputs[field] = value;
    bound.push({ field, value, source, note });
  };

  for (const [field, fieldSchema] of Object.entries(properties)) {
    const explicitValue = explicit.get(field);
    if (explicitValue !== undefined) {
      assign(field, coerce(fieldSchema, explicitValue), 'explicit', `read "${field}=" from the intent`);
      continue;
    }
    if (fieldSchema.enum) {
      const match = fieldSchema.enum.find(
        (option) =>
          typeof option === 'string' &&
          new RegExp(`\\b${option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(intent),
      );
      if (match !== undefined) {
        assign(field, match, 'enum', `"${String(match)}" appears in the intent and is a valid value`);
        continue;
      }
    }
  }

  const textCandidates = Object.keys(properties)
    .filter((field) => inputs[field] === undefined)
    .filter((field) => {
      const type = properties[field]?.type;
      return type === 'string' || (Array.isArray(type) && type.includes('string'));
    })
    .filter((field) => !isPathParameter(properties[field] as JsonSchema))
    .sort((a, b) => {
      const rank = (field: string): number => {
        const index = TEXT_FIELDS.indexOf(field.toLowerCase());
        return index === -1 ? TEXT_FIELDS.length + (required.has(field) ? 0 : 1) : index;
      };
      return rank(a) - rank(b);
    });

  const freeText = quoted ?? phrase;
  const primary = textCandidates[0];
  if (freeText && primary) {
    assign(
      primary,
      freeText,
      quoted ? 'quoted' : 'phrase',
      quoted ? 'quoted text in the intent' : 'phrase after a naming word in the intent',
    );
    freeTextUsed = true;
  }

  for (const field of required) {
    if (inputs[field] !== undefined) continue;
    const fieldSchema = properties[field];
    if (!fieldSchema) continue;
    // Identifiers point at one specific record. Guessing one would be a
    // different operation than the user asked for.
    if (isPathParameter(fieldSchema) || operation.destructive) continue;
    const example = fieldSchema.examples?.[0];
    if (example !== undefined) {
      assign(
        field,
        example,
        'observed-default',
        'not mentioned; reused the value observed during discovery',
      );
    }
  }

  const missing = [...required].filter((field) => inputs[field] === undefined);
  void freeTextUsed;
  return { inputs, bound, missing };
}
