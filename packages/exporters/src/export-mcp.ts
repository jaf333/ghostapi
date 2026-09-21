import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isReadOnly, type Operation, type Target } from '@ghostapi/core';
import { readTemplate } from './templates.js';
import { selectForExport, type SelectionOptions, type SelectionResult } from './select.js';

export interface ExportResult {
  readonly outDir: string;
  readonly files: string[];
  readonly selection: SelectionResult;
}

export interface McpExportOptions extends SelectionOptions {
  readonly target: Target;
  readonly operations: readonly Operation[];
  readonly outDir: string;
  /** Absolute path of the GhostAPI store, written into the runnable config. */
  readonly storeRoot?: string;
  readonly version?: string;
}

function toolManifest(operation: Operation): Record<string, unknown> {
  return {
    name: operation.name,
    title: operation.name,
    description: operation.description,
    inputs: operation.inputs,
    transport: operation.transport,
    fallbacks: operation.fallbacks,
    auth: operation.auth,
    destructive: operation.destructive,
    idempotent: operation.idempotent ?? false,
    readOnly: isReadOnly(operation),
  };
}

/**
 * Writes a self-contained stdio MCP server.
 *
 * Self-contained because the point of exporting is that the artifact outlives
 * this machine's workspace. It carries the operations and a small replay
 * runtime; it carries no secrets, and destructive tools are refused unless the
 * operator opts in through the server's own environment.
 */
export async function exportMcp(options: McpExportOptions): Promise<ExportResult> {
  const selection = selectForExport(options.operations, options);
  const outDir = options.outDir;
  await mkdir(outDir, { recursive: true });

  const manifest = {
    serverName: `ghostapi-${options.target.slug}`,
    version: options.version ?? '0.1.0',
    targetSlug: options.target.slug,
    targetOrigin: options.target.origin,
    generatedAt: new Date().toISOString(),
    operations: selection.selected.map(toolManifest),
  };

  const files: string[] = [];
  const write = async (name: string, content: string): Promise<void> => {
    await writeFile(join(outDir, name), content, 'utf8');
    files.push(name);
  };

  await write('operations.json', `${JSON.stringify(manifest, null, 2)}\n`);
  await write('runtime.mjs', await readTemplate('runtime.mjs'));
  await write('server.mjs', await readTemplate('mcp-server.mjs'));
  await write(
    'package.json',
    `${JSON.stringify(
      {
        name: `ghostapi-mcp-${options.target.slug}`,
        version: options.version ?? '0.1.0',
        private: true,
        type: 'module',
        bin: { [`ghostapi-mcp-${options.target.slug}`]: './server.mjs' },
        dependencies: { '@modelcontextprotocol/sdk': '^1.30.0' },
      },
      null,
      2,
    )}\n`,
  );

  const clientConfig = {
    mcpServers: {
      [`ghostapi-${options.target.slug}`]: {
        command: 'node',
        args: [join(outDir, 'server.mjs')],
        env: {
          ...(options.storeRoot ? { GHOSTAPI_HOME: options.storeRoot } : {}),
        },
      },
    },
  };
  await write('mcp.json', `${JSON.stringify(clientConfig, null, 2)}\n`);

  await write(
    'README.md',
    [
      `# ghostapi-${options.target.slug}`,
      '',
      `An MCP server for operations GhostAPI discovered on ${options.target.origin}.`,
      '',
      '## Install',
      '',
      '```bash',
      `cd ${outDir}`,
      'npm install',
      '```',
      '',
      '## Connect',
      '',
      'Copy `mcp.json` into your client configuration, or point the client at:',
      '',
      '```bash',
      `node ${join(outDir, 'server.mjs')}`,
      '```',
      '',
      '## Tools',
      '',
      ...selection.selected.map(
        (operation) =>
          `- \`${operation.name}\` — ${operation.description}${operation.destructive ? ' **(destructive)**' : ''}`,
      ),
      '',
      '## Credentials',
      '',
      'This directory contains no credentials.',
      '',
      '- `browser-session` operations read the local GhostAPI session store via `GHOSTAPI_HOME`, or `GHOSTAPI_COOKIE` if set.',
      '- `header` operations read the environment variable named in the operation.',
      '',
      'Destructive tools refuse to run unless `GHOSTAPI_ALLOW_DESTRUCTIVE=1` is set for the server process.',
      '',
      ...(selection.excluded.length > 0
        ? [
            '## Not exported',
            '',
            ...selection.excluded.map((entry) => `- \`${entry.name}\` — ${entry.reason}`),
            '',
          ]
        : []),
    ].join('\n'),
  );

  return { outDir, files, selection };
}
