# Launch day — the runbook

Everything in this file is a command or a click. Work top to bottom. Anything
already done is marked; the rest needs a human, and says why.

## Done

- [x] Repository at `github.com/jaf333/ghostapi`, **private**, `main`, topics set,
      issues and discussions on. Every reference in the repository points at it.
- [x] Community files: `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`,
      issue templates (bug + discovery report), PR template.
- [x] Brand assets generated from one source: `node scripts/render-brand.mjs`
      writes `assets/ghostapi-mark.png` and `assets/ghostapi-social.png`.
- [x] Publishing prepared: registry pinned to npmjs.org, `pnpm release` wired,
      `pnpm -r publish --dry-run` clean. See [release.md](../release.md).
- [x] Launch film built from this repository's own output.

## Needs you — before anything is public

1. **npm.** The two tokens on this machine return 401 and the global `.npmrc`
   points at a private registry, so this cannot be automated:

   ```bash
   npm login                  # registry.npmjs.org
   npm org create ghostapi    # claims the @ghostapi scope, free for public packages
   ```

   `ghostapi` and `@ghostapi/*` were both unclaimed as of 2026-09-22. Claim them
   the day you decide to launch, not the day you launch — a name taken between
   the two is a broken README.

2. **Prove it on something that is not ours.** This is the launch's real
   blocker. Run `ghostapi open` against two or three applications you have an
   account on and are allowed to automate, and record what happened — including
   the one that fails. A named failure earns more credit than a demo that only
   ever works.

   Add the result to `GATES.md` as a new gate. Until that exists, the first
   comment on Hacker News writes itself: _"of course it works on a server you
   wrote yourself."_

3. **Social preview.** GitHub has no API for it. Settings → General → Social
   preview → upload `assets/ghostapi-social.png` (1280×640).

4. **CI.** No workflows exist here: the standing policy on this machine retired
   GitHub Actions as a CI executor. `pnpm verify` is the project's CI and runs
   anywhere. If you want a green check on contributors' pull requests, that is a
   deliberate exception to re-enable for this repository alone.

## Launch day, in order

1. Re-measure and rebuild, the same morning:

   ```bash
   pnpm install && pnpm build
   pnpm verify                              # 15/15
   node scripts/measure-demo.mjs            # rewrites docs/benchmark-results.json
   node scripts/gates/check-docs.mjs        # fails if the README drifted
   node scripts/capture-demo-output.mjs --out ./out/capture
   ```

   If any figure moved, update the README, the film and the drafts before
   posting. Never publish a number you did not just measure.

2. `pnpm release` — publish to npm.

3. Verify the published package on a machine that has never seen this repository:

   ```bash
   cd "$(mktemp -d)" && npx --yes ghostapi@latest doctor
   ```

4. Make the repository public:

   ```bash
   gh repo edit jaf333/ghostapi --visibility public --accept-visibility-change-consequences
   ```

5. **Show HN**, 08:00–09:00 ET, Tuesday or Wednesday. Title and first comment in
   [hacker-news.md](./hacker-news.md). Post the first comment immediately.

6. **X thread**, same moment. Five posts, in [x-post.md](./x-post.md). Link the
   repository, not the Hacker News thread.

7. Reddit a few hours later, only if Hacker News moved:
   [reddit.md](./reddit.md).

8. Then spend the day in the replies. A repository's reach is won in answers,
   not in the post.

## What not to do

- Do not ask for upvotes anywhere.
- Do not open with a benchmark you cannot reproduce on the spot.
- Do not demo against a company known to be aggressive about automation.
- Do not argue the terms-of-service question past one reply. The answer is in
  [x-post.md](./x-post.md); give it once and move on.
