import { confidenceBand, describeAuth, type JsonSchema, type Operation } from '@ghostapi/core';
import { boolFlag, parse, requirePositional, stringFlag } from '../args.js';
import { openStore } from '../context.js';
import {
  confidenceBar,
  emitJson,
  heading,
  keyValues,
  note,
  out,
  style,
  symbols,
  table,
} from '../ui.js';

function typeLabel(schema: JsonSchema | undefined): string {
  if (!schema) return 'unknown';
  if (schema.enum) return schema.enum.map((value) => String(value)).join(' | ');
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : ['unknown'];
  const base = types.join(' | ');
  return schema.nullable ? `${base} | null` : base;
}

export function describeInputs(operation: Operation): string[][] {
  const properties = operation.inputs.properties ?? {};
  const required = new Set(operation.inputs.required ?? []);
  return Object.keys(properties)
    .sort((a, b) => Number(required.has(b)) - Number(required.has(a)) || a.localeCompare(b))
    .map((key) => {
      const schema = properties[key];
      return [
        key,
        typeLabel(schema),
        required.has(key) ? 'required' : style.gray('optional'),
        schema?.format ?? (schema?.examples?.[0] !== undefined ? style.gray(`e.g. ${JSON.stringify(schema.examples[0])}`) : ''),
      ];
    });
}

export async function operationsCommand(argv: readonly string[]): Promise<void> {
  const parsed = parse(argv, { all: { type: 'boolean', default: false } });
  const store = await openStore();
  const target = await store.requireTarget(stringFlag(parsed, 'target'));
  const operations = await store.listOperations(target.slug);

  if (boolFlag(parsed, 'json')) {
    emitJson(
      operations.map((operation) => ({
        name: operation.name,
        verb: operation.verb,
        entity: operation.entity,
        description: operation.description,
        confidence: operation.confidence,
        verified: operation.verified,
        destructive: operation.destructive,
        transport: operation.transport.type,
        inputs: operation.inputs,
      })),
    );
    return;
  }

  if (operations.length === 0) {
    heading(`${target.name} has no operations yet`);
    note('Run `ghostapi open <url>`, use the app once, and GhostAPI will learn from it.');
    out();
    return;
  }

  heading(`${target.name} ${style.gray(`· ${target.origin}`)}`);
  out();
  table(
    [
      { header: 'operation' },
      { header: 'verb' },
      { header: 'transport' },
      { header: 'confidence' },
      { header: '' },
    ],
    operations.map((operation) => [
      style.bold(operation.name),
      operation.verb,
      [operation.transport, ...operation.fallbacks].map((transport) => transport.type).join('+'),
      confidenceBar(operation.confidence),
      [
        operation.verified ? symbols.ok : '',
        operation.destructive ? style.yellow('destructive') : '',
      ]
        .filter(Boolean)
        .join(' '),
    ]),
  );
  out();
  note(`${operations.length} operation(s). Run \`ghostapi inspect <operation>\` for the evidence.`);
  out();
}

export async function inspectCommand(argv: readonly string[]): Promise<void> {
  const parsed = parse(argv, {});
  const name = requirePositional(parsed, 0, 'operation name');
  const store = await openStore();
  const target = await store.requireTarget(stringFlag(parsed, 'target'));
  const operation = await store.requireOperation(target.slug, name);

  if (boolFlag(parsed, 'json')) {
    emitJson(operation);
    return;
  }

  const transport = operation.transport;
  const derivedFrom =
    transport.type === 'http'
      ? `${transport.method} ${transport.urlTemplate}`
      : transport.type === 'graphql'
        ? `GraphQL ${transport.operationName ?? 'operation'} at ${transport.endpoint}`
        : transport.type === 'browser'
          ? `browser: ${transport.steps.length} recorded step(s)`
          : `WebMCP tool ${transport.toolName}`;

  heading(`Operation: ${style.bold(operation.name)}`);
  out();
  out(operation.description);
  out();
  keyValues([
    ['derived from', derivedFrom],
    ['observed', `${operation.observationCount} time(s)`],
    ['confidence', `${confidenceBar(operation.confidence)}  ${confidenceBand(operation)}`],
    ['verified', operation.verified ? `${symbols.ok} replayed without the UI` : style.gray('not yet replayed')],
    ['destructive', operation.destructive ? style.yellow('yes — requires --yes') : 'no'],
    ['idempotent', operation.idempotent === undefined ? 'unknown' : operation.idempotent ? 'yes' : 'no'],
    ['auth', describeAuth(operation.auth)],
    [
      'transports',
      [operation.transport, ...operation.fallbacks].map((item) => item.type).join(' → '),
    ],
  ]);

  if (operation.uiTriggers.length > 0) {
    out();
    out(style.gray('UI triggers observed'));
    for (const trigger of operation.uiTriggers) {
      out(`  ${symbols.bullet} ${trigger.kind} ${trigger.description} ${style.gray(`×${trigger.count}`)}`);
    }
  }

  const inputs = describeInputs(operation);
  out();
  out(style.gray('Inputs'));
  if (inputs.length === 0) {
    out(`  ${style.gray('none')}`);
  } else {
    table(
      [{ header: '  name' }, { header: 'type' }, { header: '' }, { header: '' }],
      inputs.map(([name, type, required, extra]) => [`  ${name}`, type ?? '', required ?? '', extra ?? '']),
    );
  }

  out();
  out(style.gray('Evidence'));
  for (const item of operation.evidence.slice(0, 10)) {
    out(`  ${style.gray(item.kind.padEnd(10))} ${item.note}`);
  }
  out();
}

export async function targetsCommand(argv: readonly string[]): Promise<void> {
  const parsed = parse(argv, {});
  const store = await openStore();
  const targets = await store.listTargets();
  const config = await store.config();

  if (boolFlag(parsed, 'json')) {
    emitJson({ defaultTarget: config.defaultTarget, targets });
    return;
  }

  if (targets.length === 0) {
    heading('No targets yet');
    note('Run `ghostapi open <url>` to create one.');
    out();
    return;
  }

  heading('Targets');
  out();
  const rows = await Promise.all(
    targets.map(async (target) => {
      const operations = await store.listOperations(target.slug);
      return [
        target.slug === config.defaultTarget ? `${symbols.arrow} ${style.bold(target.slug)}` : `  ${target.slug}`,
        target.origin,
        `${operations.length} op(s)`,
      ];
    }),
  );
  table([{ header: '  name' }, { header: 'origin' }, { header: 'operations' }], rows);
  out();
}
