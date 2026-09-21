# Research: what GhostAPI reuses, and what it does not

Written before the architecture was fixed, and updated as decisions were verified
in code. Every claim below was checked against the package registry, a published
repository or a running process. Anything that could not be verified says so.

---

## 1. Jev / TypeSafe AI — adopted, behind an interface

**What it actually is.** `typesafe-ai/jev` is not a GitHub repository; it is a
model identifier on the Vercel AI Gateway. The model is TypeSafe AI's "System
One": it answers _typed questions_ with a confidence and a probability
distribution, and it cannot generate prose. The bare `jev` package on npm is an
unrelated 84-byte placeholder and must not be depended on.

**What we use.**

| Path    | Package                        | Credential           | Notes                                                 |
| ------- | ------------------------------ | -------------------- | ----------------------------------------------------- |
| Direct  | `@typesafe-ai/sdk@0.6.0` (MIT) | `TYPESAFE_API_KEY`   | `confidence` is a first-class typed field             |
| Gateway | none — raw `fetch`             | `AI_GATEWAY_API_KEY` | evaluation-model protocol, model id `typesafe-ai/jev` |

The direct path uses `client.systemOne({ state, questions: { selection: choice(...) } })`
and reads `answers.selection.choice`, `.confidence` and `.probabilities`.

The gateway path posts to `https://ai-gateway.vercel.sh/v4/ai/evaluation-model`
with the `ai-evaluation-model-specification-version: 4` header, exactly as
`vercel-labs/json-render` does. That is why `@ghostapi/decision` adds **no**
dependency for the gateway path: the protocol is a single `fetch`.

The Vercel AI SDK also exposes `experimental_evaluate` from `ai@7`, which is the
same capability with provider portability. We did not adopt it because it would
pull the whole SDK in for one function, and because it reports confidence only
inside `providerMetadata.typesafe.confidence`, which is a less stable contract
than the native field.

**Where Jev is used, and where it is not.** Jev decides _which operation an
intent means_. It does not extract arguments, write descriptions, or name
operations. Those are deterministic, because a decision model is the wrong tool
for extraction and because a rule a person can read is worth more here than a
model call. See `packages/decision/src/extract-arguments.ts`.

**Why the default engine is deterministic.** `HeuristicDecisionEngine` ships as
the default so that `ghostapi ask` works with no API key, on a plane, and in CI —
and so that a test of the routing layer measures the routing layer. A hosted
decision model is an upgrade, never a requirement. `selectEngine('auto')` prefers
Jev, then the gateway, then the deterministic engine, and reports which one it
used and why the others were skipped.

---

## 2. agent-browser — studied closely, deliberately not a dependency

`vercel-labs/agent-browser` (npm `agent-browser@0.38.1`, Apache-2.0) is the
closest prior art. Its bundled `derive-client` skill describes almost exactly
GhostAPI's pitch: record traffic into a HAR, identify the interesting endpoints,
extract them, generate a client, verify it.

We read it, and then did not depend on it:

- **It has no Node API.** The package ships `bin` entries and platform binaries —
  no `main`, no `types`, no `exports`. Programmatic use means spawning a process
  and parsing stdout, which is a CLI-shaped RPC layer around an unversioned
  output format.
- **Its bodies land in a HAR on `network har stop`.** That is a batch artifact.
  GhostAPI's correlator needs per-response events _as they happen_, to link them
  to the interaction that caused them.
- **2 MB per-body cap** and a multi-platform Rust binary payload.

So the capture layer is Playwright (`playwright-core@1.63`, Apache-2.0) driving a
CDP session directly: `Network.enable`, `requestWillBeSent`,
`requestWillBeSentExtraInfo`, `responseReceived`, `loadingFinished` and
`Network.getResponseBody`. `chromium.launchPersistentContext` gives the
per-target profile that lets a user sign in by hand once.

`playwright-core` rather than `playwright`: it downloads no browsers, and
`channel: 'chrome'` uses the Chrome the user already has.

**What we took from it anyway.** Two things `derive-client` gets right and we
copied as design constraints, not code: its failure taxonomy (expired sessions,
per-form CSRF tokens, signed request parameters, A/B-varying payloads) shaped
`packages/discovery`, and `dev3000`'s warning that a separate browser profile
breaks OAuth sign-in made persistent profiles a day-one feature rather than a
later one.

`BrowserDriver` in `packages/browser/src/types.ts` is the seam: agent-browser, a
remote CDP endpoint or a hosted browser can be plugged in without touching
discovery or execution.

**What `derive-client` does not do, and GhostAPI does.** It is a prompt that asks
an agent to hand-write a client from `jq` output. It does not build a typed
operation model, does not diff observations to infer which fields are parameters,
does not score its own confidence, and emits no MCP server, Skill or typed
client. That gap is the product.

---

## 3. Model Context Protocol — v1 low-level server, on purpose

`@modelcontextprotocol/sdk@1.30.0` (MIT) and `@modelcontextprotocol/server@2.0.0`
are both current; v2 is the new stable line.

We use **v1's low-level `Server`** with `ListToolsRequestSchema` and
`CallToolRequestSchema`, for one reason: GhostAPI already has JSON Schema. The
high-level `registerTool` API wants Zod (v1 rejects plain JSON Schema since
1.28.0; v2 wants Standard Schema), so using it would mean generating Zod source
from inferred schemas and back again. The protocol-level handlers take the JSON
Schema we already have, verbatim.

Tool annotations are set from real evidence rather than defaults: a GET-derived
operation gets `readOnlyHint: true`, a destructive one `destructiveHint: true`,
and everything gets `openWorldHint: true` because every GhostAPI tool talks to a
third-party application.

`vercel-labs/mcp-handler@2.2.0` is the right hosting layer if GhostAPI ever
serves MCP over HTTP. It peer-depends on `@modelcontextprotocol/server@^2.0.0`,
so adopting it means moving to v2 — a deliberate, later decision.

---

## 4. Agent Skills — the portable six-field spec

The spec moved to `agentskills.io`. The portable frontmatter allows exactly six
keys: `name`, `description`, `license`, `compatibility`, `metadata`,
`allowed-tools`. Claude Code accepts a superset, but any non-spec key hard-errors
on upload elsewhere, so the exporter emits only the six.

Two rules that matter specifically for generated skills, and that
`packages/exporters/src/export-skill.ts` enforces with tests:

1. **The description may not contain `<` or `>`.** GhostAPI generates
   descriptions from URLs and type names, so `Array<User>` or `/users/<id>` would
   fail validation. `sanitizeDescription` strips them.
2. **`name` must equal the parent directory name**, match `^[a-z0-9-]+$`, avoid
   `--`, and stay under 64 characters. A target slug like `127-0-0-1-4123` or a
   long host name has to be normalised.

The catalogue goes in `references/operations.md`, not in `SKILL.md` — that is the
whole point of progressive disclosure, and it is what keeps the skill useful as
the operation count grows.

`skills@1.7.0` (`npx skills add …`) is the distribution channel and needs nothing
from us beyond a spec-compliant directory.

---

## 5. Scanned and not reused

| Project                     | Verdict                                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `vercel-labs/dev3000`       | Prior art, not a dependency. Same capture surface, but its output is a _log_; GhostAPI's is a _schema_. It stops where we start.   |
| `vercel-labs/mcp-to-ai-sdk` | Arrow points the other way — it generates clients _from_ servers. Its codegen layout informed our TypeScript exporter.             |
| `vercel-labs/agent-eval`    | Test-time only, and about evaluating _coding agents_. The idea we took is asserting on how a run happened, not only on its output. |
| `vercel-labs/json-render`   | Not a dependency, but the source of the raw-fetch gateway evaluation call we use.                                                  |
| `vercel-labs/opensrc`       | No overlap.                                                                                                                        |
| `vercel-labs/just-bash`     | Not needed: GhostAPI replays HTTP, it does not need a shell. Relevant later if exported Skills ever ship executable scripts.       |

---

## 6. Decisions we made against the original brief

**SQLite was considered and rejected for the MVP.** The brief suggested it for
correlation queries. The queries GhostAPI actually runs are "read every
observation of one session" and "list the operations" — a directory answers both.
Plain JSON and NDJSON are diffable, greppable, inspectable by hand, and add no
native dependency. `GhostStore` is the seam if that changes.

**The demo target has no framework.** The brief suggested Next.js. Using a
framework for the reference application would have made it harder to argue that
discovery is generic, and would have tied CI to a framework's release cadence.
`apps/demo-target` is Node's own `http` module and a vanilla SPA: zero
dependencies, real session auth, real REST, real GraphQL.

**The browser figure in the benchmark is a scripted replay, not an LLM agent.**
We cannot measure an agent we did not build, and inventing its numbers would be
the exact dishonesty the brief warns against. The benchmark therefore compares a
_scripted_ browser replay — no model in the loop — against the discovered API,
and says so in its own output. A real browser agent adds model latency and tokens
on top, so the measured ratio understates the gap rather than inflating it.
