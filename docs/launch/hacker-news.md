# Hacker News

**Title**

> Show HN: GhostAPI – Watch a web app, derive typed operations, skip the browser

Keep the title factual. No superlatives, no "AI-powered".

---

**First comment (post immediately)**

Hi HN. GhostAPI came out of a frustration with browser agents: they click through
a UI that is already making clean API calls. The clicking is the expensive part
and it is the part we could remove.

You run `ghostapi open <url>`, sign in yourself, and use the app once. GhostAPI
watches the network over CDP and the interactions from inside the page,
correlates them, and derives reusable operations — `createTodo({title,
projectId, priority})`, not `postApiTodos`. Then it replays them directly.

Three things I'd genuinely like feedback on:

**1. Correlation.** "The click immediately before the request" is wrong often
enough to matter. I score five signals — temporal proximity, whether values you
typed appear verbatim in the payload, the CDP initiator type, whether the page
changed afterwards, and how often the endpoint repeats — and mark anything
within 0.08 of a runner-up as ambiguous rather than resolving it silently. I
suspect there are better signals I'm missing, particularly for apps that batch
mutations.

**2. Inference discipline.** An enum needs three samples, two distinct values and
fewer distinct values than samples. A field is optional only if a sample was
missing it. This makes single-session discovery conservative — often _too_
conservative — but the alternative is shipping guesses as types. I'd rather be
under-confident and say so.

**3. The benchmark.** The repo reports 2390 ms (browser) vs 2 ms (API), 1195×.
I want to be precise about what that is: the browser figure is a **scripted
replay** of recorded UI steps with **no model in the loop**. I can't measure an
LLM browser agent I didn't build, and inventing its numbers would be dishonest.
A real agent adds model latency and tokens on top, so the ratio understates the
gap. Anything unmeasurable prints `unavailable`.

On security, since it's the obvious question: redaction happens where evidence
enters the system, so observations never hold a credential. Operations reference
auth abstractly (`{"strategy":"header","env":"MY_TOKEN"}`), which is what makes
an exported MCP server safe to publish. One file holds your session, 0600 and
gitignored, and it is excluded from every export by construction. There's a test
that takes the live session cookie and greps every stored and exported file for
it.

It does not break authentication or bypass controls — it reuses a session you
established by hand. Only use it where you're allowed to automate.

The repo ships its own target app, a recorded session and the benchmark script,
so every number is reproducible without touching anyone else's site.

MIT.

---

**Prepared answers**

_"Isn't this just HAR-to-client?"_ — HAR gives you requests. The work is deciding
which requests are the same operation, which segments are parameters, which
fields are required, which are enums, and which UI action caused what. That, plus
keeping the evidence so you can audit the answer.

_"Sites will break this."_ — Sometimes, and GhostAPI says so: expired sessions
produce an actionable error, not a 401 dump, and operations that can't be
replayed keep a browser fallback. It degrades instead of failing.

_"Why Jev and not GPT-4?"_ — Routing an intent to one of eight known operations
is a closed choice with a confidence attached, not a generation task. A decision
model is the right shape. The default engine is deterministic and offline anyway.

_"Legal?"_ — Same as any automation: depends on the site's terms and your
relationship to it. GhostAPI doesn't circumvent controls, and the README says so
rather than being coy.

---

Figures above come from `docs/benchmark-results.json`. Re-run
`node scripts/measure-demo.mjs` before posting and update them; never publish a
number you did not just measure.
