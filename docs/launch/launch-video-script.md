# Launch video — 30 seconds

Narrated, captioned, 1:1 for the feed and 16:9 for the README. No music, no
sound effects. The terminal is the star; let it be dense and let it be real.

The film is built from this repository's own output. Every character of terminal
text on screen comes from `node scripts/capture-demo-output.mjs`, and both
figures in the closing comparison come from `docs/benchmark-results.json`.
Nothing is written for the camera.

Source project: `ghostapi-video/videos/ghostapi-launch` (HyperFrames).

---

| Time        | Frame                 | On screen                                                                                                              | Narration                                                                                     |
| ----------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 0.00–4.27   | 1 The clicking        | A cursor works a spare form; each click prints `POST /api/todos 201` into a column beside it                           | _Your browser agent is clicking through a UI that's already calling a clean API._             |
| 4.27–11.27  | 2 Watching            | The live discovery feed: `click Create` → `submit Create` → `POST /api/todos 201`, ×3, then `✓ 8 operation(s) derived` | _GhostAPI watches while you use the app once, matching every click to the request it caused._ |
| 11.27–15.68 | 3 The receipt         | `confidence █████████░ 94% likely`, `verified not yet replayed`, the priority enum, `submit form "Create" ×5`          | _It derives the operation — typed, with a confidence and the evidence behind it._             |
| 15.68–19.72 | 4 Without the browser | `ghostapi ask "create a todo called buy coffee"` → `engine heuristic` → `201`, `7 ms`                                  | _Then it runs without the browser. Plain language in, a typed call out._                      |
| 19.72–23.53 | 5 Handed over         | Four MCP tools written; beneath a rule, the withheld ones with their reasons                                           | _Your agent gets an MCP server. Destructive tools held back._                                 |
| 23.53–27.03 | 6 The number          | `2390 ms` against `2 ms`, with the measurement's fine print under both                                                 | _Two point four seconds of clicking, down to two milliseconds._                               |
| 27.03–30.03 | 7 The repository      | The mascot, `GhostAPI`, `MIT · github.com/jaf333/ghostapi`, held still                                                 | — (silent)                                                                                    |

---

## Rules

- **Every number on screen is real.** Re-run `node scripts/measure-demo.mjs` and
  `node scripts/capture-demo-output.mjs` the same day and rebuild from those
  files. If a take shows a different latency than the caption, re-cut the
  caption, not the take.
- **No fake progress bars, no sped-up terminal.** If discovery takes twelve
  seconds, cut to the result — do not pretend it took two.
- **Show the confidence number, and show `verified not yet replayed` with it.**
  A system declining to claim more than it has earned is the strongest beat in
  the film, and it costs one line.
- **The fine print stays legible.** The closing comparison carries "median of 5
  timed runs after one untimed warm-up · the browser path is a scripted UI
  replay with no model in the loop". It is not a disclaimer to hide at 40%
  opacity; it is the reason the headline is believable.
- **It must read with the sound off.** X autoplays muted, so the captions carry
  every spoken line.
- The final frame is the repository URL, held about two seconds, completely
  static.

---

## Alternate 15-second cut

Frames 2, 4 and 6 only: the feed deriving `createTodo`, the natural-language
call returning 201 with no browser, and `2390 ms → 2 ms`. Same assets, same
narration lines 2, 4 and 6.

---

Figures above come from `docs/benchmark-results.json`. Re-run
`node scripts/measure-demo.mjs` before posting and update them; never publish a
number you did not just measure.
