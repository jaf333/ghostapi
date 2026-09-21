import { resolve } from 'node:path';
import { ErrorCodes, GhostError } from '@ghostapi/core';
import {
  exportMcp,
  exportSkill,
  exportTypescript,
  readTargetBundle,
  writeTargetBundle,
} from '@ghostapi/exporters';
import { boolFlag, parse, requirePositional, stringFlag } from '../args.js';
import { openStore } from '../context.js';
import { emitJson, heading, keyValues, note, out, step, style } from '../ui.js';

const KINDS = ['mcp', 'skill', 'ts', 'target'] as const;
type Kind = (typeof KINDS)[number];

export async function exportCommand(argv: readonly string[]): Promise<void> {
  const parsed = parse(argv, {
    out: { type: 'string' },
    'include-weak': { type: 'boolean', default: false },
    'include-destructive': { type: 'boolean', default: false },
    only: { type: 'string', multiple: true },
  });
  const kind = requirePositional(parsed, 0, 'export kind') as Kind;
  if (!KINDS.includes(kind)) {
    throw new GhostError({
      code: ErrorCodes.InvalidInput,
      title: 'Unknown export kind',
      detail: `"${kind}" is not something GhostAPI can export.`,
      remedy: `Choose one of: ${KINDS.join(', ')}.`,
    });
  }

  const store = await openStore();
  const target = await store.requireTarget(stringFlag(parsed, 'target'));
  const operations = await store.listOperations(target.slug);
  const only = (parsed.values.only as string[] | undefined) ?? [];
  const selectionOptions = {
    includeWeak: boolFlag(parsed, 'include-weak'),
    includeDestructive: boolFlag(parsed, 'include-destructive'),
    ...(only.length > 0 ? { only } : {}),
  };
  const outRoot = resolve(stringFlag(parsed, 'out') ?? `out/${target.slug}`);
  const json = boolFlag(parsed, 'json');

  if (kind === 'target') {
    const file = stringFlag(parsed, 'out') ?? `${target.slug}.ghost.json`;
    const bundle = await store.exportBundle(target.slug, 'ghostapi/0.1.0');
    await writeTargetBundle(resolve(file), bundle);
    if (json) {
      emitJson({ file: resolve(file), operations: bundle.operations.length });
      return;
    }
    heading('Target exported');
    keyValues([
      ['file', resolve(file)],
      ['operations', String(bundle.operations.length)],
    ]);
    out();
    note('No credentials are included. Import it elsewhere with `ghostapi import <file>`.');
    out();
    return;
  }

  if (kind === 'mcp') {
    const result = await exportMcp({
      target,
      operations,
      outDir: `${outRoot}/mcp`,
      storeRoot: store.paths.root,
      ...selectionOptions,
    });
    if (json) {
      emitJson({
        outDir: result.outDir,
        tools: result.selection.selected.map((operation) => operation.name),
        excluded: result.selection.excluded,
      });
      return;
    }
    heading('MCP server exported');
    keyValues([
      ['directory', result.outDir],
      ['tools', String(result.selection.selected.length)],
    ]);
    out();
    for (const operation of result.selection.selected) {
      step(`${operation.name} ${style.gray(operation.description.split('.')[0] ?? '')}`);
    }
    reportExcluded(result.selection.excluded);
    out();
    note('Run it:');
    note(`  cd ${result.outDir} && npm install && node server.mjs`);
    note('Or copy mcp.json into your MCP client configuration.');
    out();
    return;
  }

  if (kind === 'skill') {
    const result = await exportSkill({
      target,
      operations,
      outDir: `${outRoot}/skills`,
      ...selectionOptions,
    });
    if (json) {
      emitJson({ outDir: result.outDir, skill: result.skillName, files: result.files });
      return;
    }
    heading('Agent Skill exported');
    keyValues([
      ['directory', result.outDir],
      ['skill', result.skillName],
      ['operations', String(result.selection.selected.length)],
    ]);
    reportExcluded(result.selection.excluded);
    out();
    note('Install it for Claude Code:');
    note(`  cp -r ${result.outDir} ~/.claude/skills/`);
    out();
    return;
  }

  const result = await exportTypescript({
    target,
    operations,
    outDir: `${outRoot}/ts`,
    ...selectionOptions,
  });
  if (json) {
    emitJson({ outDir: result.outDir, files: result.files });
    return;
  }
  heading('TypeScript client exported');
  keyValues([
    ['directory', result.outDir],
    ['methods', String(result.selection.selected.length)],
  ]);
  reportExcluded(result.selection.excluded);
  out();
  note('Use it:');
  note("  import { createGhostClient } from './client.js';");
  out();
}

function reportExcluded(excluded: readonly { name: string; reason: string }[]): void {
  if (excluded.length === 0) return;
  out();
  note('Not exported:');
  for (const entry of excluded) note(`  ${entry.name} — ${entry.reason}`);
}

export async function importCommand(argv: readonly string[]): Promise<void> {
  const parsed = parse(argv, { 'allow-private-network': { type: 'boolean', default: false } });
  const file = requirePositional(parsed, 0, 'target file');
  const store = await openStore();
  const audit = await readTargetBundle(resolve(file), {
    allowPrivateNetwork: boolFlag(parsed, 'allow-private-network'),
  });
  const result = await store.importBundle(audit.bundle);

  if (boolFlag(parsed, 'json')) {
    emitJson({ ...result, warnings: audit.warnings });
    return;
  }
  heading('Target imported');
  keyValues([
    ['target', result.slug],
    ['operations', String(result.operations)],
  ]);
  if (audit.warnings.length > 0) {
    out();
    note('Review before running:');
    for (const warning of audit.warnings) note(`  ${warning}`);
  }
  out();
  note(`Authenticate with:  ghostapi open ${audit.bundle.target.startUrl}`);
  out();
}
