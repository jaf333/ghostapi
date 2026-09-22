## What changed

<!-- The behaviour that is different now, not the files you touched. -->

## Proof

<!--
Every claim in this project has a command that proves it. Give the commands you
ran and what they printed.
-->

```console
$ pnpm test
$ pnpm typecheck
$ node scripts/verify.mjs <the gates your change touches>
```

## Checklist

- [ ] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass
- [ ] The gates affected by this change pass, and a new capability brought a new gate into `GATES.md`
- [ ] No target-specific identifier entered `packages/discovery`
- [ ] No inference is presented as certainty; thin evidence lowers confidence and `inspect` shows why
- [ ] No figure is printed that was not measured — `unavailable` with a reason instead
- [ ] Any new capture path redacts where evidence enters, with a test proving a live secret does not reach disk
