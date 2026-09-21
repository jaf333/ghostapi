# Reddit

Targets: r/LocalLLaMA, r/programming, r/webdev, r/ExperiencedDevs.
Each needs its own framing. Do not cross-post the same text.

---

## r/LocalLLaMA

**Title:** I got tired of my agent clicking through UIs, so I made it learn the API underneath

Browser-use style agents burn tokens looking at a DOM to find a button that
fires a request they could have made directly.

GhostAPI watches the app while you use it once, correlates your interactions
with its network traffic, and derives typed operations. Then it replays them —
no browser, no DOM, no vision model.

Measured on the reference app in the repo: 7860 ms → 68 ms, 1 request instead of
33, zero model calls on the fast path.

Being precise about that number: the browser figure is a scripted replay with no
model in the loop, because I can't measure an agent I didn't build. A real one is
slower, so the gap is bigger than shown.

Routing natural language to an operation uses a decision model (Jev) rather than
a chat model — it's a closed choice with a confidence, not a generation task. The
default engine is deterministic and needs no API key at all.

Exports an MCP server, an Agent Skill and a typed TS client. MIT.

---

## r/programming

**Title:** Deriving typed API operations from observed browser traffic

Write-up of the interesting parts:

**Correlating a click with a request.** "Closest in time" is wrong often enough
to matter. Five weighted signals — temporal proximity, whether your typed values
appear verbatim in the payload, CDP initiator type, state change after the
response, endpoint repetition. Ties break toward the more committal interaction:
a submit beats a change. Anything within 0.08 of the runner-up is marked
ambiguous instead of guessed.

**Path templating.** A segment that varies across samples is a parameter. With
one sample, only its shape can speak — and `user_profile` must not be read as an
id just because it has an underscore, so the suffix has to contain a digit.

**Enum inference.** Three samples, two distinct values, fewer distinct values
than samples. One request saying `priority: "high"` is a guess dressed as a type.

**A CDP gotcha worth the price of admission.** Chrome adds `Cookie` _after_
`requestWillBeSent`, on a separate `requestWillBeSentExtraInfo` event that can
arrive after the response. Miss it and you conclude a cookie-authenticated app
needs no auth. Ask me how I know.

MIT, reproducible benchmark, reference app included.

---

## r/webdev

**Title:** Your app already has a clean API. Here's a tool that finds it by watching you use it.

Point it at an app, sign in, use it once. It writes down the operations behind
the buttons, with schemas, and gives you a typed TypeScript client.

Useful beyond agents: scripting an internal tool that never got an API, testing,
or just seeing what your own frontend actually sends.

It reuses the session you signed into. No credential ever gets stored in an
export.
