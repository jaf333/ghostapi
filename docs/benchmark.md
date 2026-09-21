# Benchmark

## What is measured

Two paths to the same result, timed in the same process:

| Path                           | What it does                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `browser (recorded UI replay)` | Opens Chrome, navigates, fills the recorded form fields, presses the recorded submitter, settles. |
| `ghostapi (direct API)`        | Sends the one HTTP request the operation was derived from.                                        |

## What is _not_ measured, and why

The browser path runs **no model**. It is a scripted replay of steps GhostAPI
recorded, not an LLM agent reasoning over a DOM.

That is deliberate. An LLM browser agent's latency and token cost depend on which
model, which harness and which prompt — we did not build one, so we cannot
measure one, and inventing the numbers would be exactly the dishonesty this
project is supposed to avoid.

The consequence is worth stating plainly: **a real browser agent is slower than
the figure below, not faster.** It adds model latency per step and tokens per
observation on top of the same clicking. The ratio reported here is therefore a
floor.

Anything the benchmark cannot measure prints `unavailable` with a reason:

```text
tokens: unavailable — no model ran on this path
```

Never an estimate, never a dash that could be mistaken for zero.

## Reproducing it

```bash
pnpm install && pnpm build
node scripts/measure-demo.mjs
```

That script runs the whole pipeline against `apps/demo-target` — the reference
application in this repository — and writes `docs/benchmark-results.json`. Every
figure in the README comes from that file, and `scripts/gates/check-docs.mjs`
fails if they drift apart.

For a single operation in an existing workspace:

```bash
ghostapi benchmark createTodo '{"title":"x","projectId":"prj_inbox","priority":"normal"}' --runs 5
```

## Reading the result

The current figures for this repository live in
[benchmark-results.md](benchmark-results.md), generated from
`benchmark-results.json`. No table in the documentation is typed by hand.

- **interactions** — steps the browser path had to perform. The API path performs
  none, which is the point.
- **requests** — the browser path loads a page, its assets and its data; the API
  path sends one request.
- **model calls** — zero on both paths here. `ghostapi run` executes a typed
  operation directly; no model is involved. `ghostapi ask` adds exactly one
  decision call, and reports its token usage when the engine provides it.

## Caveats a reader should hold onto

- Numbers come from one machine. Compare ratios, not absolutes.
- The reference application is local, so network latency is near zero for both
  paths. Over a real network the browser path's extra 32 requests cost _more_
  relatively, not less.
- The first API call in a process pays Node's fetch warm-up. `--runs` averages it
  away; with `--runs 1` expect a higher figure.
- A browser run includes a fresh navigation each time. An agent already sitting
  on the page would be faster than this — and still slower than one request.
