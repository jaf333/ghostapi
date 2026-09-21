# Architecture

GhostAPI is four planes with one rule between them: **evidence flows forward,
credentials never do.**

```text
DISCOVERY        a real browser, CDP capture, the user's own session
      ↓          raw, redacted evidence
NORMALIZATION    correlation → templating → schema inference → operations
      ↓          the Operation IR
EXECUTION        transport chain: API first, browser last
      ↓          results + traces
AGENT INTERFACE  CLI · MCP · Agent Skill · TypeScript · web inspector
```

Each plane is a package, and each package depends only on `@ghostapi/core`.

| Package               | Responsibility                                                            |
| --------------------- | ------------------------------------------------------------------------- |
| `@ghostapi/core`      | The IR: operations, transports, evidence, auth, traces, redaction, safety |
| `@ghostapi/store`     | File-backed persistence for targets, observations, operations, traces     |
| `@ghostapi/browser`   | Playwright driver, CDP network capture, page instrumentation              |
| `@ghostapi/discovery` | Correlation, path templating, schema and operation inference              |
| `@ghostapi/executor`  | Binding resolution, auth references, transport chain                      |
| `@ghostapi/decision`  | `DecisionEngine` implementations and intent routing                       |
| `@ghostapi/exporters` | MCP server, Agent Skill, TypeScript client, target bundle                 |
| `@ghostapi/eval`      | Eval suites and the measured benchmark                                    |
| `ghostapi`            | The CLI                                                                   |
| `@ghostapi/web`       | Local inspector (Next.js)                                                 |

---

## 1. Discovery

`chromium.launchPersistentContext` opens **your** Chrome against a per-target
profile directory. You sign in by hand. GhostAPI never sees a password.

Two capture channels run at once:

**Network, over CDP.** `Network.enable`, then `requestWillBeSent`,
`requestWillBeSentExtraInfo`, `responseReceived` and `loadingFinished`, with
`Network.getResponseBody` and `Network.getRequestPostData` for the payloads a
page never exposes to itself.

> `requestWillBeSentExtraInfo` matters more than it looks. Chrome adds
> network-layer headers — `Cookie` among them — _after_ it emits
> `requestWillBeSent`, on a separate event that can land after the response.
> Merging it at the last possible moment is what stops GhostAPI concluding that
> a cookie-authenticated application needs no authentication.

**UI, from inside the page.** An init script records clicks, submits, changes and
Enter/Escape keys, with a selector, an accessible label, the enclosing form's
fields, and — for a submit — the control that actually submitted it. A
`MutationObserver` and patched history methods record state changes.

Everything is redacted **here**, at the boundary where evidence enters:
credential-bearing headers by name, key names matching a denylist, values
matching high-signal credential formats (JWT, `Bearer`, `sk-…`, `ghp_…`,
`AKIA…`), and any literal the session is known to hold. Redaction preserves JSON
shape so inference stays correct. Nothing downstream can leak what it never
received.

Password fields are recognised in the page and their values are never sent to
the Node side at all.

## 2. Normalization

**Correlation.** Each request is matched to the interaction that most plausibly
caused it, by weighted score:

| Signal                | Weight | What it measures                                        |
| --------------------- | -----: | ------------------------------------------------------- |
| `temporalProximity`   |   0.35 | Full strength within 250 ms, decaying to zero at 4 s    |
| `payloadSimilarity`   |   0.30 | Values the user typed appearing verbatim in the request |
| `initiatorEvidence`   |   0.15 | CDP initiator: `script` beats `parser`                  |
| `stateChangeEvidence` |   0.10 | The page changed within 1.5 s of the response           |
| `repetitionEvidence`  |   0.10 | How often this endpoint has been seen                   |

Above 0.45 the link is made. Ties break toward more matched values, then toward
the more _committal_ interaction — a submit is the user saying "do it", a change
is them still typing. Two candidates within 0.08 are marked **ambiguous** rather
than silently resolved.

One interaction may own several requests: a click that creates a record also
refreshes the list. A request has exactly one cause.

**Grouping and templating.** Requests are grouped by method, origin and a path
skeleton with id-shaped segments masked. Within a group, a segment that _varies_
across samples is a parameter; with a single sample, only its shape can speak.
Parameters are named after the collection before them: `/api/todos/{todoId}`.

**Schema inference.** From the samples in a group:

- required only if present in _every_ sample;
- an enum needs ≥3 samples, ≥2 distinct values, and fewer distinct values than
  samples — and its most frequent member becomes the example, because that is the
  only defensible default;
- `integer` and `number` collapse to one numeric type; `null` alongside a value
  means nullable;
- `date-time`, `date`, `uuid`, `email`, `uri` are recognised only when every
  sample matches.

**Naming.** Endpoint _shape_ plus method, with no knowledge of any application:

| Shape      | Method               | Name                                                             |
| ---------- | -------------------- | ---------------------------------------------------------------- |
| collection | POST                 | `createTodo`                                                     |
| collection | GET                  | `listTodos`, or `searchTodos` when a search parameter is typical |
| item       | GET / PATCH / DELETE | `getTodo` / `updateTodo` / `deleteTodo`                          |
| action     | POST                 | `archiveTodo`                                                    |

A gate scans the discovery engine's executable code for any target-specific
identifier and fails if it finds one.

**Auth inference.** Authentication is a property of the _origin_, not of one
request — a single observation without a `Cookie` header is weak evidence of a
public endpoint. The one exception: a sign-in request cannot carry the session it
is about to create.

## 3. Execution

An operation names its transports in preference order: `http` → `graphql` →
`webmcp` → `browser`. Execution walks that chain. A failure in the preferred
transport is what gets reported, because a browser fallback that was never
configured is a consequence, not a cause.

Bindings are **data**:

```jsonc
{
  "kind": "object",
  "properties": {
    "title": { "kind": "input", "field": "title" },
    "source": { "kind": "literal", "value": "web" },
  },
}
```

There is no string templating and no expression syntax. Resolution is a tree
walk. A value that arrived from an untrusted page cannot become behaviour.

Auth is resolved at call time into headers that are never persisted, never
logged and never exported.

Every execution produces a trace: `input.validated → request.prepared →
response.received`, with ids.

**Browser fallback** is derived from the interaction that produced the operation:
navigate, fill the fields the operation binds, press the recorded submitter,
settle. It asserts that the expected backend request actually happened, so
"the steps ran" is never mistaken for "the work was done".

## 4. Agent interface

Same operations, four surfaces. Export selection is deliberately conservative:
weak inferences and destructive operations are held back unless asked for, and
browser-only operations are excluded from artifacts that cannot start a browser.

---

## Storage

```text
.ghostapi/
  config.json
  targets/<slug>/
    target.json           the target definition
    auth.json             the session — 0600, gitignored, never exported
    profile/              Chrome's user-data directory
    observations/*.ndjson redacted evidence, append-only
    operations/*.json     one file per operation
    traces/*.json         one file per execution
    evals/*.yaml          eval suites
```

Plain files, not SQLite. The queries GhostAPI actually runs are "read one
session" and "list the operations"; a directory answers both, and it is diffable,
greppable and inspectable by hand. `GhostStore` is the seam if that ever changes.

---

## Extension points

| Interface        | Swap in                                                        |
| ---------------- | -------------------------------------------------------------- |
| `BrowserDriver`  | agent-browser, a remote CDP endpoint, a hosted browser         |
| `DecisionEngine` | Jev, the AI Gateway, your own model, the deterministic default |
| `Transport`      | a new protocol, without touching discovery or the CLI          |
| `GhostStore`     | SQLite or a server, if correlation ever outgrows files         |
