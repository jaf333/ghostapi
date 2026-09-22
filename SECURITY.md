# Security policy

GhostAPI reads other people's applications through your own browser session. A
defect here does not just crash a process — it can write a credential to disk or
carry one into an export. Treat anything in that class as security-sensitive.

## Reporting

Open a [security advisory](https://github.com/jaf333/ghostapi/security/advisories/new).
Not a public issue.

Report privately if you find any of:

- a credential value reaching an observation, operation, trace, export or log
- an export that carries a secret rather than a reference to one
- page-derived text reaching a model or a tool description without sanitisation
- an imported `.ghost` target escaping schema validation or the blocked address ranges
- an operation classified as safe that destroys data

You will get a first response within 72 hours. Include the smallest reproduction
you can, against the reference app in `apps/demo-target` where possible — and
never paste the real credential, only the path it travelled.

## Supported versions

Pre-1.0: only the latest release gets fixes.

## What GhostAPI is not

It does not break authentication, bypass access controls or evade bot detection.
It reuses a session you established yourself, in your own browser. Reports that
ask for any of those capabilities are declined, not fixed.

The full threat model is in [docs/security.md](docs/security.md).
