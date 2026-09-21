# X / Twitter

All figures below come from `docs/benchmark-results.json`, produced by
`node scripts/measure-demo.mjs`. **Re-run it before posting** and update the
numbers — never post a figure you did not just measure.

---

## Main post (thread opener)

> I clicked a button once.
>
> GhostAPI learned the operation behind it.
>
> Now any agent can use it without the browser.
>
> 7860ms → 68ms. Same result.
>
> [video]

---

## Thread

**2/**

> Browser agents click through UIs. But the UI is already calling an API.
>
> GhostAPI watches that traffic while _you_ use the app, correlates what you did
> with what it sent, and writes down the operation.

**3/**

> It doesn't dump endpoints. It derives operations.
>
> Not `postApiTodos`.
> `createTodo({ title, projectId, priority: 'high' | 'low' | 'normal' })`
>
> The enum came from watching. One sample would have been a guess.

**4/**

> Every operation shows its work:
>
> derived from POST /api/todos
> observed 5 times
> confidence 94%
> triggers submit form "Create" ×5
>
> Weak inference is never shown as certainty.

**5/**

> Then export it:
>
> ghostapi export mcp → a runnable MCP server
> ghostapi export skill → an Agent Skill
> ghostapi export ts → a typed client
>
> Zero credentials in any of them. Operations reference auth; they don't hold it.

**6/**

> The honest version of the benchmark:
>
> the browser number is a _scripted replay_ with no model in the loop. A real
> LLM browser agent is slower still. The comparison understates the gap.
>
> Anything we can't measure prints "unavailable". Never an estimate.

**7/**

> Browser when necessary, APIs whenever possible.
>
> Some apps can't be replayed — per-form CSRF, signed params. GhostAPI keeps a
> browser fallback for exactly those, and prefers it over failing.

**8/**

> MIT. Reference app, recorded session and benchmark script in the repo, so you
> can reproduce every number without touching anyone else's website.
>
> github.com/ghostapi/ghostapi

---

## Notes

- Lead with the video. No preamble.
- Never say "reverse engineer anything" or "convert any website into an API".
  The claim is: _turn web apps into agent-native operations_.
- If someone asks about ToS, answer plainly: GhostAPI reuses a session you
  established yourself and does not bypass any control. Use it where you are
  allowed to automate.
