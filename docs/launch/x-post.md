# X / Twitter

All figures below come from `docs/benchmark-results.json`, produced by
`node scripts/measure-demo.mjs`. **Re-run it before posting** and update the
numbers — never post a figure you did not just measure. The terminal lines come
from `node scripts/capture-demo-output.mjs`; quote that output, never a
transcript typed for the occasion.

Five posts, not eight. A thread nobody finishes is a thread nobody shares.

---

## 1/ — the opener

> A browser can repeat UI steps that already trigger API calls.
>
> I used a reference app. GhostAPI observed the action and derived a typed
> operation from its network traffic.
>
> It can replay that operation with a direct HTTP request.
>
> [video]

Lead with the video. No preamble, no "excited to share".

---

## 2/ — what it actually does

> GhostAPI watches the traffic while _you_ use the app, correlates what you did
> with what it sent, and writes down the operation.
>
> Not `postApiTodos`.
> `createTodo({ title, projectId, priority: 'high' | 'low' | 'normal' })`
>
> The enum came from watching. One sample would have been a guess.

---

## 3/ — the receipt

> Every operation shows its work:
>
> derived from POST /api/todos
> observed 5 times
> confidence 94%
> verified not yet replayed
>
> Nothing reaches "verified" from observation alone — only an actual successful
> replay outside the UI does that.

`verified not yet replayed` is the line engineers screenshot. Keep it.

---

## 4/ — the honest benchmark

> In our local reference app: 2390 ms → 2 ms, median of 5 timed runs after one
> warm-up.
>
> The browser figure is a _scripted replay_ with no model in the loop. Neither
> path measures an LLM agent or its token usage.
>
> Anything we can't measure prints "unavailable". Never an estimate.

Post this one even though it weakens the headline. It is the reason the headline
gets believed, and it is what people quote when they recommend the project.

---

## 5/ — the ask

> ghostapi export mcp → a runnable MCP server
> ghostapi export skill → an Agent Skill
> ghostapi export ts → a typed client
>
> Zero credentials in any of them. Destructive tools withheld unless you ask.
>
> MIT, with the reference app and the benchmark script in the repo so you can
> reproduce every number without touching anyone else's website.
>
> github.com/jaf333/ghostapi

---

## Replies to have ready

- **"Is this legal / what about ToS?"** GhostAPI reuses a session you
  established yourself, in your own browser. It does not break authentication,
  bypass access controls or evade bot detection. Use it where you are allowed to
  automate.
- **"It only works on your toy app."** Say which real applications you tested,
  and which ones failed and why. A named failure buys more credit than a
  hand-wave.
- **"CSRF tokens / signed params will break this."** They do, and the README
  says so. GhostAPI keeps a browser fallback for exactly those and prefers it
  over failing.
- **"Why not just read the OpenAPI spec?"** Because most internal applications
  do not publish one, and the ones that do rarely describe what the UI actually
  calls.

## Never say

- "reverse engineer anything"
- "convert any website into an API"
- "AI-powered" anything

The claim is: _turn web apps into agent-native operations_.
