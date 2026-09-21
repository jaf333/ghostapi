# Gates: GhostAPI MVP

OWNS: packages/**, apps/**, scripts/**, docs/**, examples/**, README.md, package.json, pnpm-workspace.yaml, turbo.json, tsconfig.base.json, .github/**

Scope: A working open-source GhostAPI MVP that observes a real web app in a real browser, derives typed reusable operations from observed network evidence, replays them without the UI, routes natural-language intent to them, and exports them as MCP / Agent Skill / TypeScript clients — with tests, evals, a measured benchmark and launch docs.

- [ ] G1: Every package builds and typechecks under TypeScript strict mode with no errors.
      CHECK: node scripts/gates/check-build.mjs
      EXPECT: GATE_G1_BUILD_OK
      EVIDENCE: pending

- [ ] G2: Unit tests for schema inference, correlation scoring, secret redaction, operation naming, safety classification and serialization all pass.
      CHECK: node scripts/gates/check-unit.mjs
      EXPECT: GATE_G2_UNIT_OK
      EVIDENCE: pending

- [ ] G3: The demo target is a real HTTP application with session auth and a real JSON API (not a fixture file).
      CHECK: node scripts/gates/check-demo-target.mjs
      EXPECT: GATE_G3_TARGET_OK
      EVIDENCE: pending

- [ ] G4: A real browser session drives a real UI action against the demo target and GhostAPI captures the resulting request AND response bodies as persisted observations.
      CHECK: node scripts/gates/check-capture.mjs
      EXPECT: GATE_G4_CAPTURE_OK
      EVIDENCE: pending

- [ ] G5: From those observations alone — with no app-specific knowledge in the discovery engine — GhostAPI derives a semantically named createTodo operation and infers its input schema (required title, optional fields), and the engine contains no demo-target-specific identifiers.
      CHECK: node scripts/gates/check-inference.mjs
      EXPECT: GATE_G5_INFERENCE_OK
      EVIDENCE: pending

- [ ] G6: `ghostapi run createTodo '{"title":...}'` creates a todo through the discovered HTTP transport with no browser and no UI interaction, confirmed by reading the target's state afterwards.
      CHECK: node scripts/gates/check-run.mjs
      EXPECT: GATE_G6_RUN_OK
      EVIDENCE: pending

- [ ] G7: `ghostapi ask "<intent>"` routes natural language to the correct operation through the pluggable DecisionEngine, binds arguments, executes, and emits a trace.
      CHECK: node scripts/gates/check-ask.mjs
      EXPECT: GATE_G7_ASK_OK
      EVIDENCE: pending

- [ ] G8: A browser-transport operation executes end to end through the browser fallback and changes real application state.
      CHECK: node scripts/gates/check-browser-fallback.mjs
      EXPECT: GATE_G8_FALLBACK_OK
      EVIDENCE: pending

- [ ] G9: `ghostapi export mcp` emits a runnable stdio MCP server whose tools an MCP client can list and successfully call over the protocol.
      CHECK: node scripts/gates/check-mcp.mjs
      EXPECT: GATE_G9_MCP_OK
      EVIDENCE: pending

- [ ] G10: `ghostapi export skill` emits a valid Agent Skill and `ghostapi export ts` emits a typed client that compiles against the generated types.
      CHECK: node scripts/gates/check-exports.mjs
      EXPECT: GATE_G10_EXPORTS_OK
      EVIDENCE: pending

- [ ] G11: `ghostapi eval` executes real cases against the live target and `ghostapi benchmark` reports only measured figures, printing an explicit unavailable marker for anything it cannot measure.
      CHECK: node scripts/gates/check-eval-benchmark.mjs
      EXPECT: GATE_G11_EVAL_OK
      EVIDENCE: pending

- [ ] G12: No observed credential value (cookie, authorization header, bearer token, password field) appears in any persisted observation, operation, trace, export or log; verified against a positive control that proves the detector fires when a secret IS present.
      CHECK: node scripts/gates/check-redaction.mjs
      EXPECT: GATE_G12_REDACTION_OK
      EVIDENCE: pending

- [ ] G13: A target definition exports to a portable file and re-imports into a clean workspace with its operations intact and no credentials inside.
      CHECK: node scripts/gates/check-target-portability.mjs
      EXPECT: GATE_G13_PORTABILITY_OK
      EVIDENCE: pending

- [ ] G14: The web UI builds for production and renders operations read from the real local store.
      CHECK: node scripts/gates/check-web.mjs
      EXPECT: GATE_G14_WEB_OK
      EVIDENCE: pending

- [ ] G15: README and launch docs let an outside reader install and reproduce the demo; every number printed in the README is produced by a command in the repository rather than written by hand.
      CHECK: node scripts/gates/check-docs.mjs
      EXPECT: GATE_G15_DOCS_OK
      EVIDENCE: pending
