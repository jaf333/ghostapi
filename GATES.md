# Gates: GhostAPI MVP

OWNS: packages/**, apps/**, scripts/**, docs/**, examples/**, README.md, package.json, pnpm-workspace.yaml, turbo.json, tsconfig.base.json, .github/**

Scope: A working open-source GhostAPI MVP that observes a real web app in a real browser, derives typed reusable operations from observed network evidence, replays them without the UI, routes natural-language intent to them, and exports them as MCP / Agent Skill / TypeScript clients — with tests, evals, a measured benchmark and launch docs.

- [x] G1: Every package builds and typechecks under TypeScript strict mode with no errors.
      CHECK: node scripts/gates/check-build.mjs
      EXPECT: GATE_G1_BUILD_OK
      EVIDENCE: 2026-09-21 22:22 — ran `node scripts/gates/check-build.mjs`; printed GATE_G1_BUILD_OK (turbo build --force and typecheck clean across 11 packages)

- [x] G2: Unit tests for schema inference, correlation scoring, secret redaction, operation naming, safety classification and serialization all pass.
      CHECK: node scripts/gates/check-unit.mjs
      EXPECT: GATE_G2_UNIT_OK
      EVIDENCE: 2026-09-21 22:22 — ran `node scripts/gates/check-unit.mjs`; printed GATE_G2_UNIT_OK — 259 unit tests passed, every named area present

- [x] G3: The demo target is a real HTTP application with session auth and a real JSON API (not a fixture file).
      CHECK: node scripts/gates/check-demo-target.mjs
      EXPECT: GATE_G3_TARGET_OK
      EVIDENCE: 2026-09-21 22:22 — ran `node scripts/gates/check-demo-target.mjs`; printed GATE_G3_TARGET_OK — 401 without a session, CRUD, search, archive, delete, GraphQL and the SPA all verified over HTTP

- [x] G4: A real browser session drives a real UI action against the demo target and GhostAPI captures the resulting request AND response bodies as persisted observations.
      CHECK: node scripts/gates/check-capture.mjs
      EXPECT: GATE_G4_CAPTURE_OK
      EVIDENCE: 2026-09-21 22:22 — ran `node scripts/gates/check-capture.mjs`; printed GATE_G4_CAPTURE_OK — 26 requests, 32 interactions, 12 state changes captured with request and response bodies; the password field was recorded as redacted and analytics traffic was absent

- [x] G5: From those observations alone — with no app-specific knowledge in the discovery engine — GhostAPI derives a semantically named createTodo operation and infers its input schema (required title, optional fields), and the engine contains no demo-target-specific identifiers.
      CHECK: node scripts/gates/check-inference.mjs
      EXPECT: GATE_G5_INFERENCE_OK
      EVIDENCE: 2026-09-21 22:22 — ran `node scripts/gates/check-inference.mjs`; printed GATE_G5_INFERENCE_OK — 8 operations derived, createTodo typed with a three-member priority enum, and the discovery engine scanned clean of target-specific identifiers against a positive control

- [x] G6: `ghostapi run createTodo '{"title":...}'` creates a todo through the discovered HTTP transport with no browser and no UI interaction, confirmed by reading the target's state afterwards.
      CHECK: node scripts/gates/check-run.mjs
      EXPECT: GATE_G6_RUN_OK
      EVIDENCE: 2026-09-21 22:22 — ran `node scripts/gates/check-run.mjs`; printed GATE_G6_RUN_OK — createTodo replayed over HTTP in 163 ms and confirmed present by querying the application directly

- [x] G7: `ghostapi ask "<intent>"` routes natural language to the correct operation through the pluggable DecisionEngine, binds arguments, executes, and emits a trace.
      CHECK: node scripts/gates/check-ask.mjs
      EXPECT: GATE_G7_ASK_OK
      EVIDENCE: 2026-09-21 22:22 — ran `node scripts/gates/check-ask.mjs`; printed GATE_G7_ASK_OK — routed with the deterministic engine at 90.0% confidence, executed, and refused to invent an identifier it had not been given

- [x] G8: A browser-transport operation executes end to end through the browser fallback and changes real application state.
      CHECK: node scripts/gates/check-browser-fallback.mjs
      EXPECT: GATE_G8_FALLBACK_OK
      EVIDENCE: 2026-09-21 22:22 — ran `node scripts/gates/check-browser-fallback.mjs`; printed GATE_G8_FALLBACK_OK — the browser transport created a record in 2463 ms, confirmed against the application

- [x] G9: `ghostapi export mcp` emits a runnable stdio MCP server whose tools an MCP client can list and successfully call over the protocol.
      CHECK: node scripts/gates/check-mcp.mjs
      EXPECT: GATE_G9_MCP_OK
      EVIDENCE: 2026-09-21 22:22 — ran `node scripts/gates/check-mcp.mjs`; printed GATE_G9_MCP_OK — a real MCP client listed 4 annotated tools from the exported server and executed createTodo and listTodos over the protocol

- [x] G10: `ghostapi export skill` emits a valid Agent Skill and `ghostapi export ts` emits a typed client that compiles against the generated types.
      CHECK: node scripts/gates/check-exports.mjs
      EXPECT: GATE_G10_EXPORTS_OK
      EVIDENCE: 2026-09-21 22:22 — ran `node scripts/gates/check-exports.mjs`; printed GATE_G10_EXPORTS_OK — SKILL.md validated against the six-key spec and the generated TypeScript client compiled under strict mode

- [x] G11: `ghostapi eval` executes real cases against the live target and `ghostapi benchmark` reports only measured figures, printing an explicit unavailable marker for anything it cannot measure.
      CHECK: node scripts/gates/check-eval-benchmark.mjs
      EXPECT: GATE_G11_EVAL_OK
      EVIDENCE: 2026-09-21 22:22 — ran `node scripts/gates/check-eval-benchmark.mjs`; printed GATE_G11_EVAL_OK — 7/7 eval cases passed with destructive cases held back, and the benchmark reported measured medians with an explicit unavailable marker for tokens

- [x] G12: No observed credential value (cookie, authorization header, bearer token, password field) appears in any persisted observation, operation, trace, export or log; verified against a positive control that proves the detector fires when a secret IS present.
      CHECK: node scripts/gates/check-redaction.mjs
      EXPECT: GATE_G12_REDACTION_OK
      EVIDENCE: 2026-09-21 22:22 — ran `node scripts/gates/check-redaction.mjs`; printed GATE_G12_REDACTION_OK — the live session cookie was absent from 12 stored and 16 exported files, with a positive control proving the scanner fires

- [x] G13: A target definition exports to a portable file and re-imports into a clean workspace with its operations intact and no credentials inside.
      CHECK: node scripts/gates/check-target-portability.mjs
      EXPECT: GATE_G13_PORTABILITY_OK
      EVIDENCE: 2026-09-21 22:22 — ran `node scripts/gates/check-target-portability.mjs`; printed GATE_G13_PORTABILITY_OK — 8 operations round-tripped, the import carried no session, and a bundle aimed at a private address was refused

- [x] G14: The web UI builds for production and renders operations read from the real local store.
      CHECK: node scripts/gates/check-web.mjs
      EXPECT: GATE_G14_WEB_OK
      EVIDENCE: 2026-09-21 22:22 — ran `node scripts/gates/check-web.mjs`; printed GATE_G14_WEB_OK — next build succeeded and the served pages rendered operations, evidence and the network feed from the real store

- [x] G15: README and launch docs let an outside reader install and reproduce the demo; every number printed in the README is produced by a command in the repository rather than written by hand.
      CHECK: node scripts/gates/check-docs.mjs
      EXPECT: GATE_G15_DOCS_OK
      EVIDENCE: 2026-09-22 09:58 — ran `node scripts/gates/check-docs.mjs`; printed GATE_G15_DOCS_OK — every README figure matched docs/benchmark-results.json (2390 ms to 2 ms, 1195x), re-measured the same day

- [ ] G16: GhostAPI derives and replays a usable operation from a real third-party web application — not the reference app in this repository — and the applications it cannot handle are named along with the reason.
      CHECK: node scripts/verify.mjs real-targets
      EXPECT: GATE_G16_REAL_TARGETS_OK
      EVIDENCE: not yet earned. Everything above is proven against `apps/demo-target`, which this repository wrote. Until this gate is green the honest claim is "it derives operations from the reference application", and any launch should expect that objection first. The procedure, and what the gate must assert, are in [docs/launch/real-target-validation.md](docs/launch/real-target-validation.md).
