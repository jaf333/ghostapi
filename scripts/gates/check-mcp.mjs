import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { REPO, check, discoveredWorkspace, exists, ghostapiJson, pass, readJson } from './lib.mjs';

// Exported into the CLI package so Node resolves @modelcontextprotocol/sdk by
// walking up, exactly as it would after `npm install` in a real export.
const outDir = join(REPO, 'packages', 'cli', '.gate-out');

const { target, cwd, storeRoot } = await discoveredWorkspace();
let client;
try {
  await rm(outDir, { recursive: true, force: true });
  const exported = ghostapiJson(['export', 'mcp', '--out', outDir], { cwd });
  const serverDir = join(outDir, 'mcp');

  for (const file of ['server.mjs', 'runtime.mjs', 'operations.json', 'package.json', 'mcp.json', 'README.md']) {
    check(await exists(join(serverDir, file)), `the export is missing ${file}`);
  }
  check(exported.tools.length >= 3, `only ${exported.tools.length} tools exported`);
  check(!exported.tools.includes('deleteTodo'), 'a destructive tool was exported by default');

  const manifest = await readJson(join(serverDir, 'operations.json'));
  check(
    JSON.stringify(manifest).includes('browser-session'),
    'the manifest does not reference how to authenticate',
  );

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(serverDir, 'server.mjs')],
    env: { ...process.env, GHOSTAPI_HOME: storeRoot },
  });
  client = new Client({ name: 'ghostapi-gate', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);

  const listed = await client.listTools();
  check(listed.tools.length === exported.tools.length, 'the server lists a different tool count than it exported');

  const createTool = listed.tools.find((tool) => tool.name === 'createTodo');
  check(Boolean(createTool), 'createTodo is not exposed as a tool');
  check(typeof createTool.description === 'string' && createTool.description.length > 0, 'the tool has no description');
  check(createTool.inputSchema.type === 'object', 'the tool has no object input schema');
  check(
    Array.isArray(createTool.inputSchema.required) && createTool.inputSchema.required.includes('title'),
    'the tool schema does not require title',
  );
  check(createTool.annotations.destructiveHint === false, 'createTodo is annotated destructive');
  check(createTool.annotations.openWorldHint === true, 'createTodo is not annotated as open-world');

  const listTool = listed.tools.find((tool) => tool.name === 'listTodos');
  check(listTool?.annotations.readOnlyHint === true, 'listTodos is not annotated read-only');

  const title = `Created through MCP ${Date.now()}`;
  const call = await client.callTool({
    name: 'createTodo',
    arguments: { title, projectId: 'prj_launch', priority: 'normal' },
  });
  check(call.isError !== true, `the tool call failed: ${JSON.stringify(call.content)}`);
  const payload = JSON.parse(call.content[0].text);
  check(payload.todo.title === title, 'the tool call did not create the requested todo');

  const listedTodos = await client.callTool({ name: 'listTodos', arguments: { status: 'active' } });
  check(
    JSON.parse(listedTodos.content[0].text).todos.some((todo) => todo.title === title),
    'the created todo is not visible through the server',
  );

  const unknown = await client.callTool({ name: 'createTodo', arguments: {} });
  check(unknown.isError === true, 'the server accepted a call with no required input');

  process.stdout.write(`MCP server served ${listed.tools.length} tools and executed a real call\n`);
  pass('GATE_G9_MCP_OK');
} finally {
  await client?.close().catch(() => undefined);
  await target.stop();
  await rm(outDir, { recursive: true, force: true });
}
