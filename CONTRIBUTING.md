# Contributing

## Setup

```bash
pnpm install
pnpm build
node packages/cli/dist/bin.js doctor
```

Node ≥ 20.11 and Google Chrome. `playwright-core` downloads no browsers; GhostAPI
drives the Chrome you already have.

## The loop

```bash
pnpm test            # unit tests
pnpm typecheck       # strict TypeScript across every package
pnpm lint            # formatting
pnpm verify          # every gate in GATES.md, end to end
```

Anything that quotes GhostAPI's output — the README, a talk, a video — quotes a
file this produces, never a transcript somebody typed:

```bash
node scripts/capture-demo-output.mjs --out ./out/capture
```

It starts the reference application, replays `examples/demo-session.json` through
a real browser in a throwaway workspace, and writes each command's exact stdout
to its own file.

`pnpm verify` is this project's CI. It is a plain Node script with no service
dependencies, so it runs identically on a laptop and on whatever runner you
point at it. Individual gates take a filter:

```bash
node scripts/verify.mjs inference redaction
```

## What a change needs

**Every claim this project makes has a command that proves it.** That is what
`GATES.md` is: one line per outcome, with the check that decides it. If your
change adds a capability, add the gate. If it fixes a bug, add the test that
would have caught it.

Beyond that:

- **Discovery stays generic.** No target-specific identifier may appear in
  `packages/discovery`'s executable code — a gate enforces this. Explaining a
  rule with a concrete example in a comment is fine; branching on one is not.
- **Never present an inference as certainty.** If the evidence is thin, the
  confidence must say so and `inspect` must show why.
- **Never print a figure you did not measure.** Print `unavailable` with a
  reason instead. This applies to the README as much as to the CLI.
- **Credentials do not travel.** Redaction happens where evidence enters the
  system. If you add a capture path, redact in it, and add the test that proves
  a live secret does not reach disk.
- **Errors have three parts**: what failed, why, and what to do next. No code
  path prints "Failed."

## Repository layout

```text
apps/demo-target   the reference application: real auth, REST and GraphQL
apps/web           the local inspector
packages/core      the Operation IR and everything safety-related
packages/*         one plane of the pipeline each
scripts/gates      the executable proof of GATES.md
examples/          a recorded session, so the demo is reproducible
```

## Commits

Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`,
`perf:`. Describe the behaviour that changed, not the files you touched.

## Reporting a security issue

Open a security advisory on the repository rather than a public issue. See
[docs/security.md](docs/security.md).
