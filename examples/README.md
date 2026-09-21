# Examples

## `demo-session.json`

A recorded browser session against `apps/demo-target`: sign in, create five
todos with different priorities, search, rename, archive and delete.

It exists so the demo is reproducible without a human in the loop — the same
script drives the verification gates, the benchmark and CI.

```bash
node apps/demo-target/dist/server.js &

ghostapi open http://127.0.0.1:4123 --headless --script examples/demo-session.json
ghostapi operations
```

The five creations are deliberate: three samples is the minimum GhostAPI accepts
before inferring an enum, and the priorities repeat so that `priority` is
genuinely evidenced as `'high' | 'low' | 'normal'` rather than guessed from
distinct values.

Drop `--headless --script …` to drive it yourself. Anything you do by hand is
observed the same way.

## Using an exported client

```bash
ghostapi export ts --out ./out
cd out/ts && npx tsc -p tsconfig.json     # it compiles, with inferred types
```

```ts
import { createGhostClient } from './out/ts/client.js';

const client = createGhostClient({ cookie: process.env.SESSION_COOKIE });

const created = await client.createTodo({
  title: 'Ship GhostAPI',
  projectId: 'prj_launch',
  priority: 'high',
});
```

The client has no runtime dependency and carries no credential. Pass the session
explicitly, or set the environment variable the operation names for header-based
authentication.

## Connecting the exported MCP server

```bash
ghostapi export mcp --out ./out
cd out/mcp && npm install
```

Then point any MCP client at `out/mcp/mcp.json`, or run it directly:

```bash
GHOSTAPI_HOME=$PWD/.ghostapi node out/mcp/server.mjs
```

Destructive tools are excluded unless you export with `--include-destructive`,
and the server still refuses them unless `GHOSTAPI_ALLOW_DESTRUCTIVE=1`.
