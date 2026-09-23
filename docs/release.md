# Releasing

Nine packages ship from this workspace: `ghostapi` (the CLI, the one anybody
installs) and the eight `@ghostapi/*` libraries it depends on. They move
together on one version, because a CLI resolving a sibling from the registry is
only correct if that sibling was published from the same commit.

## One-time setup

Create the `ghostapi` organization in the npm website with a free public
packages plan, then log in on the release host:

```bash
npm login                                   # against registry.npmjs.org
```

The repository's `.npmrc` pins `registry.npmjs.org`, so a globally configured
private registry cannot capture a publish. Do not remove that line.

## Cutting a release

```bash
pnpm install
pnpm verify              # all 15 gates — nothing ships on an unproven build
pnpm release             # build → prepare-npm → pnpm -r publish --access public
```

`pnpm release` runs `scripts/prepare-npm.mjs` first. That copies `LICENSE` into
every package and writes `packages/cli/README.md` with absolute links, because
npm ships neither across package boundaries and renders no repo-relative path.
Both outputs are generated and gitignored.

`pnpm publish` rewrites each `workspace:*` to the concrete version as it packs,
so the published `ghostapi` depends on `@ghostapi/core@0.1.0` rather than on a
protocol only this workspace understands.

## Verify what shipped

```bash
cd "$(mktemp -d)"
npx --yes ghostapi@latest doctor
```

A release is not done until that command runs on a machine that has never seen
this repository.

## Version bumps

```bash
pnpm -r exec npm version <patch|minor|major> --no-git-tag-version
git commit -am "chore: release vX.Y.Z"
git tag vX.Y.Z && git push --follow-tags
```

Keep every package on the same number. A mixed set is how a CLI ends up asking
the registry for a version of its own library that does not exist.
