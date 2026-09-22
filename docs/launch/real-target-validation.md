# G16 — proving it on an application we did not write

Everything in `GATES.md` above G16 is proven against `apps/demo-target`, which
this repository wrote. That is a real HTTP application with session auth, REST
and GraphQL — it is not a fixture — but we chose its markup, its endpoints and
its shapes. An outside reader is right to discount it, and the first comment on
any public post will say so.

This file is the procedure for earning G16. Nothing here needs new code; it
needs a few evenings against applications you actually use.

## What counts

Three applications, chosen under two hard rules:

- **You have an account and you are allowed to automate it.** Your own SaaS
  tenant, your own admin panel, a client's system you are contracted to
  integrate with, an open-source app you self-host. Read the terms if you are
  unsure. If you would not be comfortable saying which application it was, pick
  a different one.
- **At least one is a SPA whose API is not documented.** A public REST API with
  an OpenAPI spec proves nothing GhostAPI is for.

Good candidates, roughly in order of how much they prove: a self-hosted tool you
run (Plausible, Umami, Grafana, a Directus or Strapi admin), a SaaS you pay for
where automation is permitted, a client's internal panel with their written
agreement.

Bad candidates, whatever they would prove: anything owned by a company known to
litigate over automation, anything holding another person's data, anything
behind a login that is not yours. The point of the exercise is credibility;
spending it on a fight is a bad trade.

## The run, per application

```bash
mkdir -p ~/ghostapi-real/<app> && cd ~/ghostapi-real/<app>
ghostapi doctor
ghostapi open https://<the-app>          # sign in yourself, then use it once, normally
ghostapi operations
ghostapi inspect <the-operation-you-care-about>
ghostapi run <that-operation> '<json>'   # the moment of truth
ghostapi export mcp
```

"Use it once, normally" means perform the workflow you would actually want an
agent to do — create the record, run the search, change the status — three to
five times, so the schema inference has more than one sample to reason from.

## What to record

For each application, write down:

| Field                                                           | Why it matters                                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| The kind of application and its API style                       | REST, GraphQL, RPC, Server Actions, something else                              |
| Operations derived, and how many were nonsense                  | The precision number nobody else will publish                                   |
| The one operation you tried to replay, and whether `run` worked | This is the gate                                                                |
| If it failed: the exact reason                                  | CSRF per form, signed parameters, bot detection, expired session, something new |
| Whether the browser fallback carried it                         | The README claims it does; prove or correct that                                |
| Confidence GhostAPI reported vs. whether it was actually right  | Calibration — is 94% worth anything?                                            |

Redact hostnames if the application is private. The **shape** of the traffic is
the evidence; its contents are not.

## The gate

G16 goes green when `node scripts/verify.mjs real-targets` asserts, from a
committed fixture rather than from a live network call:

1. At least one recorded third-party session derives an operation whose inferred
   schema matches what the application actually requires.
2. That operation replayed successfully outside the UI, evidenced by a stored
   trace with a 2xx.
3. At least one application that **failed** is recorded with its reason, so the
   ledger carries the limits as well as the wins.

The fixture is a redacted capture — no hostnames, no identifiers, no credentials
— checked against `scripts/gates/check-redaction.mjs` before it is committed.
Write the gate script the way the others are written: it prints
`GATE_G16_REAL_TARGETS_OK` or it fails loudly.

## What this changes in the README

Today `## Honest limits` says GhostAPI discovers what it observes and that some
applications cannot be replayed. When G16 is green, that section gains the only
sentence that makes the rest believable: **which real applications it worked on,
and which one it did not, and why.**

A named failure buys more credit than a demo that only ever succeeds. Publish
both or publish neither.
