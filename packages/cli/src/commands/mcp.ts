import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { isGhostError, isReadOnly } from '@ghostapi/core';
import { executeOperation } from '@ghostapi/executor';
import { selectForExport } from '@ghostapi/exporters';
import { boolFlag, parse, stringFlag } from '../args.js';
import { authFor, openStore } from '../context.js';

/**
 * Serves the live store over MCP.
 *
 * The exported server is the portable artifact; this one is the fast path for a
 * local agent, and it always reflects the operations as they are right now.
 */
export async function mcpCommand(argv: readonly string[]): Promise<void> {
  const parsed = parse(argv, {
    'include-destructive': { type: 'boolean', default: false },
    'include-weak': { type: 'boolean', default: false },
  });

  const store = await openStore();
  const target = await store.requireTarget(stringFlag(parsed, 'target'));
  const all = await store.listOperations(target.slug);
  const selection = selectForExport(all, {
    includeDestructive: boolFlag(parsed, 'include-destructive'),
    includeWeak: boolFlag(parsed, 'include-weak'),
  });
  const byName = new Map(selection.selected.map((operation) => [operation.name, operation]));

  const server = new Server(
    { name: `ghostapi-${target.slug}`, version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: selection.selected.map((operation) => ({
      name: operation.name,
      description: operation.description,
      inputSchema: {
        type: 'object' as const,
        properties: operation.inputs.properties ?? {},
        required: operation.inputs.required ?? [],
        additionalProperties: false,
      },
      annotations: {
        title: operation.name,
        readOnlyHint: isReadOnly(operation),
        destructiveHint: operation.destructive,
        idempotentHint: operation.idempotent ?? false,
        openWorldHint: true,
      },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const operation = byName.get(request.params.name);
    if (!operation) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Unknown operation "${request.params.name}".` }],
      };
    }
    try {
      const auth = await authFor(store, target);
      const result = await executeOperation({
        operation,
        inputs: (request.params.arguments ?? {}) as Record<string, unknown>,
        auth,
        confirmed: boolFlag(parsed, 'include-destructive'),
      });
      await store.saveTrace(target.slug, result.trace);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }],
        structuredContent: {
          status: result.status,
          latencyMs: result.latencyMs,
          traceId: result.trace.id,
          data: result.data,
        },
      };
    } catch (error) {
      const message = isGhostError(error)
        ? `${error.title}: ${error.detail}${error.remedy ? `\n\n${error.remedy}` : ''}`
        : error instanceof Error
          ? error.message
          : String(error);
      return { isError: true, content: [{ type: 'text' as const, text: message }] };
    }
  });

  await server.connect(new StdioServerTransport());
}
