# Launch video — 30 seconds

Silent, captioned, one take per segment. No music. No zoom effects. The terminal
is the star; let it be dense and let it be real.

Setup: dark terminal, 16px monospace, ~90 columns. Chrome window at 1280×860.
Record at 60fps, export at 1920×1080.

---

| Time      | Screen                                                                       | Caption                                             |
| --------- | ---------------------------------------------------------------------------- | --------------------------------------------------- |
| 0:00–0:03 | Terminal. Type `ghostapi open https://app.example.com`                       | _Point it at a web app._                            |
| 0:03–0:08 | Chrome opens. Sign in.                                                       | _Sign in yourself. GhostAPI never sees a password._ |
| 0:08–0:14 | Create a todo in the UI. Split view: network feed scrolling in the terminal. | _Use it once._                                      |
| 0:14–0:18 | Close the browser. Terminal prints the derived operations.                   | _8 operations derived._                             |
| 0:18–0:22 | `ghostapi inspect createTodo` — schema, confidence, evidence.                | _With schemas, confidence and evidence._            |
| 0:22–0:26 | `ghostapi ask "create a todo called buy coffee"` → 201, 24 ms.               | _No browser. No DOM. No vision model._              |
| 0:26–0:30 | Benchmark table, then the repo URL.                                          | _1826 ms → 10 ms._                                  |

---

## Rules

- **Every number on screen is real.** Re-run `node scripts/measure-demo.mjs`
  the same day and use those figures. If a take shows a different latency than
  the caption, re-cut the caption, not the take.
- **No fake progress bars, no sped-up terminal.** If discovery takes twelve
  seconds, cut to the result — do not pretend it took two.
- **Show the confidence number.** It is the proof this is engineering and not a
  demo.
- The final frame is the repo URL on a plain background, held for 2 seconds.

## Alternate 15-second cut

0:00 paste URL → 0:04 click "Create" in the UI → 0:07 "Operation discovered:
createTodo, 94%" → 0:10 `ghostapi ask "create buy coffee"` → 0:13 todo appears →
0:15 `1826ms → 10ms`.

---

Figures above come from `docs/benchmark-results.json`. Re-run
`node scripts/measure-demo.mjs` before posting and update them; never publish a
number you did not just measure.
