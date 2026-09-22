# Launch — what is done, what is pending, and the order to do it in

Written 2026-09-22, to be picked up cold. Nothing here assumes you remember the
session that produced it.

---

## State on 2026-09-22

The repository is at **`github.com/jaf333/ghostapi`**, **private**, default
branch `main`. `pnpm verify` passes 15/15. `pnpm -r publish --dry-run` is clean.
The launch film is built. Nothing is public and nothing is published.

### Already done

- **Repository.** Created private, topics set, issues and discussions on. Every
  reference in the code and docs points at `jaf333/ghostapi`.
  The original README pointed at `github.com/ghostapi/ghostapi`, a namespace
  that belongs to an unrelated GitHub user (account id 46465488) — an org of
  that name cannot be created.
- **Community files.** `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`,
  a PR template, and two issue templates: a bug report, and a _discovery report_
  for an operation GhostAPI missed, mis-typed or could not replay.
- **Brand.** `node scripts/render-brand.mjs` derives `assets/ghostapi-mark.png`
  (transparent) and `assets/ghostapi-social.png` (1280×640) from
  `assets/ghostapi-logo.png`. A stray unrelated image that shipped in the first
  commit, carrying a visible third-party signature, was removed and purged from
  history with `git filter-repo`.
- **Publishing prepared.** See [release.md](../release.md).
- **Launch film built.** Two cuts, in the HyperFrames project at
  `ghostapi-video/videos/ghostapi-launch`, kept outside this repository:
  `renders/ghostapi-launch-1x1.mp4` (X, LinkedIn) and
  `renders/ghostapi-launch-16x9.mp4` (README, Hacker News). Rebuild notes and
  two gotchas are in that project's own README.
- **Drafts.** [hacker-news.md](./hacker-news.md), [x-post.md](./x-post.md),
  [reddit.md](./reddit.md), [launch-video-script.md](./launch-video-script.md),
  [demo-checklist.md](./demo-checklist.md).

### Deliberately not done

**No GitHub Actions workflows.** The standing policy on the machine this was
built on retired Actions as a CI executor. `pnpm verify` is the project's CI: a
plain Node script with no service dependencies that runs identically on a laptop
and on any runner. If you want a green check on contributors' pull requests,
re-enabling Actions for this repository alone is a deliberate exception — decide
it, don't drift into it.

---

## Pending — blocking, in order

### 1. G16: prove it on an application we did not write

**This is the one that decides the launch.** Every gate in `GATES.md` is proven
against `apps/demo-target`, which this repository wrote. The first comment on
Hacker News writes itself: _"of course it works on a server you wrote yourself."_

Procedure, choice of applications, what to record, and what the gate must
assert: **[real-target-validation.md](./real-target-validation.md)**.

Budget a few evenings. It needs no new features — it needs GhostAPI pointed at
three real applications you are allowed to automate, and an honest record of
which one failed and why.

### 2. Claim the npm names

`ghostapi` and the `@ghostapi/*` scope were both unclaimed on 2026-09-22. Claim
them on the day you decide to launch, not the day you launch — a name taken in
between is a broken README.

```bash
npm login                  # registry.npmjs.org
npm org create ghostapi    # claims the @ghostapi scope, free for public packages
```

This could not be automated: both npm tokens in the macOS Keychain return 401.

> **The trap that was already defused.** `npm config get registry` on that
> machine resolved to a private registry (`npm.zeus.vision`, from a global
> `~/.npmrc`), and `pnpm -r publish` would have followed it. This repository's
> `.npmrc` and every package's `publishConfig.registry` now name
> `registry.npmjs.org` explicitly. **Do not remove those lines.**

### 3. Social preview

GitHub has no API for it. Settings → General → Social preview → upload
`assets/ghostapi-social.png`.

---

## Launch day, in order

**Re-measure and rebuild the same morning.** Never publish a number you did not
just measure.

```bash
pnpm install && pnpm build
pnpm verify                              # expect 15/15 — 16/16 once G16 lands
node scripts/measure-demo.mjs            # rewrites docs/benchmark-results.json
node scripts/gates/check-docs.mjs        # fails if the README drifted
node scripts/capture-demo-output.mjs --out ./out/capture
```

If any figure moved, update the README, the film and the drafts before posting.

> On 2026-09-22 the measurement came out **2390 ms → 2 ms, 1195×**. Treat a
> headline that large with suspicion: 2 ms is close to the timer's floor, and a
> ratio in four figures invites the accusation that the benchmark is rigged. An
> earlier run gave 1826 ms → 10 ms. Before posting, raise the sample count and
> publish whatever the stabler median says, even when it is less flattering.

Then:

1. `pnpm release` — publish to npm.
2. Verify on a machine that has never seen this repository:
   `cd "$(mktemp -d)" && npx --yes ghostapi@latest doctor`
3. Make it public:
   `gh repo edit jaf333/ghostapi --visibility public --accept-visibility-change-consequences`
4. **Show HN**, 08:00–09:00 ET, Tuesday or Wednesday. Title and first comment in
   [hacker-news.md](./hacker-news.md). Post the first comment immediately.
5. **X thread**, same moment. Five posts, [x-post.md](./x-post.md). Lead with the
   1:1 cut of the film. Link the repository, never the Hacker News thread.
6. Reddit a few hours later, only if Hacker News moved: [reddit.md](./reddit.md).
7. Spend the day in the replies. A repository's reach is won in answers, not in
   the post. Prepared replies are at the foot of [x-post.md](./x-post.md).

---

## What not to do

- Do not ask for upvotes anywhere.
- Do not open with a benchmark you cannot reproduce on the spot.
- Do not demo against a company known to be aggressive about automation.
- Do not argue the terms-of-service question past one reply. The answer is in
  [x-post.md](./x-post.md); give it once and move on.
- Do not claim "convert any website into an API" or "reverse engineer anything".
  The claim is: _turn web apps into agent-native operations_.
