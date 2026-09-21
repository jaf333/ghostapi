<div align="center">

<img src="assets/ghostapi-logo.png" alt="GhostAPI" width="120" />

# GhostAPI

**Turn web apps into agent-native operations.**

GhostAPI watches how a web application works,
discovers the operations behind its UI,
and exposes them as typed tools for AI agents.

Browser when necessary. APIs whenever possible.

</div>

---

```bash
npx ghostapi open https://app.example.com
# sign in, use the app once, close the window

npx ghostapi ask "create a new customer called ACME"
```

That is the whole idea:

> I clicked a button once.
> GhostAPI learned the operation behind it.
> Now every agent can use it without the browser.

---

## What just happened

You opened a real browser. GhostAPI watched the network while _you_ used the
application, correlated what you did with what the app sent, and wrote down the
operations it could justify:

```text
✓ 26 request(s) observed
✓ 32 UI interaction(s) recorded
✓ 8 operation(s) derived

  createTodo     94%  Create a todo
  listTodos      94%  List todo records
  updateTodo     80%  Update a todo
  archiveTodo    75%  Archive a todo
  deleteTodo     70%  Delete a todo
```

Now inspect one:

```console
$ ghostapi inspect createTodo

Operation: createTodo

Create a todo. Derived from POST /api/todos.

derived from  POST http://127.0.0.1:4123/api/todos
observed      5 time(s)
confidence    █████████░  94%  likely
verified      not yet replayed
destructive   no
auth          browser session cookies
transports    http → browser

UI triggers observed
  • submit form "Create" ×5

Inputs
  name       type                 required
  priority   high | low | normal  required
  projectId  string               required  e.g. "prj_inbox"
  title      string               required  e.g. "Buy milk"
```

And run it — with no browser anywhere:

```console
$ ghostapi run createTodo '{"title":"Buy bread","projectId":"prj_home","priority":"high"}'

operation  createTodo
transport  http
request    POST http://127.0.0.1:4123/api/todos
auth       browser session cookies (demo_session)
status     201
latency    26 ms
```

---

## Browser vs GhostAPI

Measured on the reference application in this repository, 5 timed runs per path
after one untimed warm-up:

|                   |              browser (recorded UI replay) | ghostapi (direct API) |
| ----------------- | ----------------------------------------: | --------------------: |
| median time       |                                   1826 ms |             **10 ms** |
| range over 5 runs |                             1267–11212 ms |               5–22 ms |
| interactions      |                                         5 |                     0 |
| requests          |                                        30 |                     1 |
| model calls       |                                         0 |                     0 |
| tokens            | _unavailable — no model ran on this path_ |                     0 |

**182.6× faster through the discovered API.**

Reproduce it yourself:

```bash
pnpm install && pnpm build
node scripts/measure-demo.mjs        # writes docs/benchmark-results.json
```

Every number in this README comes out of that file, and the full rendered table
lives in [docs/benchmark-results.md](docs/benchmark-results.md). A check in
`scripts/gates/check-docs.mjs` fails if they ever drift apart.

Each path runs once untimed to warm up, then the figure is the **median** of the
timed runs with the range beside it. A single cold run is dominated by process
warm-up, and a mean would let one outlier pick the headline.

**What the comparison is, precisely.** The browser figure is a _scripted replay_
of the recorded UI steps with no model in the loop. We cannot measure a browser
agent we did not build, and inventing its numbers would be dishonest. A real LLM
browser agent adds model latency and tokens on top of that 1826 ms, so the ratio
above understates the gap rather than inflating it. Anything GhostAPI cannot
measure prints `unavailable`, never an estimate.

---

## Install

```bash
npx ghostapi doctor      # checks Chrome, Node, sessions, decision engines
```

Requires Node ≥ 20.11 and Google Chrome. GhostAPI drives _your_ Chrome through a
per-target profile, so you sign in by hand, once, exactly as you normally would.

From source:

```bash
git clone https://github.com/ghostapi/ghostapi
cd ghostapi
pnpm install
pnpm build
node packages/cli/dist/bin.js doctor
```

---

## Try it end to end in one minute

The repository ships a real target application and a recorded session, so the
whole loop is reproducible without touching anyone else's website:

```bash
# terminal 1 — the reference application
node apps/demo-target/dist/server.js

# terminal 2
cd /tmp && mkdir demo && cd demo
GA=/path/to/ghostapi/packages/cli/dist/bin.js

node $GA open http://127.0.0.1:4123 --headless \
     --script /path/to/ghostapi/examples/demo-session.json

node $GA operations
node $GA inspect createTodo
node $GA run createTodo '{"title":"Buy bread","projectId":"prj_home","priority":"high"}'
node $GA ask "create a todo called buy coffee"
node $GA export mcp
```

Drop `--headless --script …` to drive it yourself.

---

## Give the operations to an agent

```bash
ghostapi export mcp      # a runnable stdio MCP server
ghostapi export skill    # an Agent Skill for Claude Code, Codex, Cursor
ghostapi export ts       # a dependency-free typed TypeScript client
ghostapi export target   # a portable target definition, no credentials
```

The MCP server is self-contained and carries safety annotations derived from
evidence, not from guesses:

```jsonc
{
  "name": "listTodos",
  "annotations": { "readOnlyHint": true, "destructiveHint": false, "openWorldHint": true },
}
```

Destructive tools are left out unless you ask for them, and the generated server
still refuses to run one without `GHOSTAPI_ALLOW_DESTRUCTIVE=1`.

The TypeScript client is plain `fetch` with inferred types:

```ts
import { createGhostClient } from './client.js';

const client = createGhostClient({ cookie: process.env.SESSION_COOKIE });

await client.createTodo({
  title: 'Ship GhostAPI',
  projectId: 'prj_launch',
  priority: 'high', // 'high' | 'low' | 'normal' — inferred from what was observed
});
```

---

## How it works

```text
DISCOVERY        a real browser, CDP network capture, your own session
      ↓
NORMALIZATION    correlation → path templating → schema inference → operations
      ↓
EXECUTION        direct API first, browser fallback when there is no other way
      ↓
AGENT INTERFACE  CLI · MCP · Agent Skill · TypeScript
```

The browser is the teacher. The discovered API is the student that ends up doing
the work.

**Correlation is scored, not assumed.** "The click just before the request" is
wrong often enough to matter. Every link carries five weighted signals:

```text
correlationScore = temporalProximity   0.35
                 + payloadSimilarity   0.30
                 + initiatorEvidence   0.15
                 + stateChangeEvidence 0.10
                 + repetitionEvidence  0.10
```

Two candidates within 0.08 of each other are reported as _ambiguous_ rather than
silently resolved.

**Schemas need evidence.** A field is optional only if a sample was missing it.
An enum needs at least three samples, at least two distinct values, and fewer
distinct values than samples — one request saying `priority: "high"` is a guess
dressed up as a type. `ghostapi inspect` shows exactly what each claim rests on.

**Confidence is auditable.** It is a sum of named terms, each checkable by hand,
and nothing reaches the verified band from observation alone — only an actual
successful replay outside the UI does that.

Full detail in [docs/architecture.md](docs/architecture.md); the reuse decisions
are in [docs/research.md](docs/research.md).

---

## Security

GhostAPI reads other people's applications, through your session. That shapes
every part of it. The full model is in [docs/security.md](docs/security.md); the
short version:

- **Credentials are never captured.** Redaction happens where evidence _enters_
  the system, so nothing sensitive is written to disk in the first place. Headers,
  key names, credential-shaped values and known literals are all scrubbed.
- **Operations reference credentials, never hold them.** `{"strategy":"header","env":"MY_TOKEN"}`
  or `{"strategy":"browser-session"}`. That is what makes an export safe to
  publish. One file — `auth.json`, mode `0600`, gitignored — holds your session,
  and it is excluded from every export path by construction.
- **Pages are untrusted input.** Text lifted from a page is sanitised and scanned
  for prompt injection before it reaches a model or a tool description. An
  operation is a JSON document: there is no templating, no expression syntax and
  nothing that is ever evaluated.
- **Destructive operations require an explicit `--yes`**, and classification errs
  toward destructive. A false positive costs one keypress.
- **Imported targets are hostile until proven otherwise.** A `.ghost` file gets
  schema validation, and its URLs are blocked from private and metadata address
  ranges unless you opt in.

GhostAPI does not break authentication, bypass access controls or evade bot
detection. It reuses a session you established yourself, in your own browser.
Only use it on applications you are allowed to automate.

---

## Honest limits

- GhostAPI discovers what it _observes_. An operation you never performed does
  not exist to it.
- Some applications cannot be replayed: per-form CSRF tokens, signed request
  parameters, bot detection on the API. GhostAPI keeps a browser fallback for
  exactly these, and prefers it over failing.
- Session cookies expire. When they do, `ghostapi run` says so and tells you to
  re-authenticate rather than printing a 401.
- This is not a "convert any website to an API" button, and the README will never
  claim it is.

---

## Commands

```text
ghostapi open <url>              open a browser session and learn from what you do
ghostapi observe                 re-derive operations from everything recorded
ghostapi operations              list discovered operations
ghostapi inspect <operation>     schema, request, confidence and evidence
ghostapi run <operation> [json]  execute without the UI
ghostapi ask "<intent>"          route natural language to an operation and run it
ghostapi export mcp|skill|ts|target
ghostapi import <file>
ghostapi eval                    reliability evals against the target
ghostapi benchmark <operation>   measured browser vs API comparison
ghostapi mcp                     serve current operations over stdio MCP
ghostapi doctor                  diagnose Chrome, sessions, engines, workspace
```

Add `--json` to anything that will be parsed.

---

## Natural language, without an LLM in the hot path

```console
$ ghostapi ask "create a todo called buy coffee"

Intent
  create a todo called buy coffee

Decision
operation   createTodo
confidence  90.0%
engine      heuristic

Arguments
  title = "buy coffee"      (phrase after a naming word in the intent)
  priority = "high"         (not mentioned; reused the value observed during discovery)
  projectId = "prj_inbox"   (not mentioned; reused the value observed during discovery)

Execution
status     201
latency    24 ms
```

Routing is a **closed choice** over known operation names — a page cannot
introduce an option and a model cannot invent one. Argument extraction is
deterministic and every value reports where it came from.

The default engine is deterministic and offline. Set `TYPESAFE_API_KEY` to route
with [Jev](https://typesafe.ai), TypeSafe AI's decision model, or
`AI_GATEWAY_API_KEY` to reach it through the Vercel AI Gateway:

```bash
export TYPESAFE_API_KEY=...
ghostapi ask "move yesterday's navbar bug to done" --engine jev
```

Jev is used where a _decision_ is needed and nowhere else: it picks operations,
it does not write text. `DecisionEngine` is a three-method interface — swapping
it is a constructor argument.

---

## Tests

```bash
pnpm test                                  # 258 unit tests
node scripts/gates/check-inference.mjs     # derives createTodo from a live browser session
node scripts/gates/check-mcp.mjs           # a real MCP client calls the exported server
node scripts/gates/check-redaction.mjs     # no live secret reaches disk or any export
```

`GATES.md` lists every outcome this project claims, each with the command that
proves it. Nothing in this README is asserted without one.

---

## Roadmap

- [ ] WebMCP execution — tools are already detected during discovery
- [ ] OpenAPI export alongside MCP, Skill and TypeScript
- [ ] Multi-session diffing to separate stable fields from A/B variants
- [ ] Ghost Registry: share a target definition, keep your own credentials
- [ ] Server Action and RPC inference beyond REST and GraphQL

`ghostapi export target` / `ghostapi import` already produce and consume the
portable format the registry would serve.

---

## License

MIT. See [LICENSE](LICENSE).
