# Security model

GhostAPI reads other people's applications, through your session, and hands what
it learns to agents. Those three facts drive everything here.

## Scope

GhostAPI **does not** break authentication, bypass access controls, defeat rate
limits or evade bot detection. It reuses a session you established yourself, by
hand, in your own browser. Use it only on applications you are allowed to
automate.

---

## 1. Credentials are never captured

Redaction happens where evidence _enters_ the system, not where it leaves. An
observation cannot leak a credential because it never held one.

| Layer     | What is scrubbed                                                                        |
| --------- | --------------------------------------------------------------------------------------- |
| Headers   | `authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`, `x-csrf-token`, … |
| Body keys | `password`, `token`, `secret`, `apiKey`, `credential`, `otp`, `cvv`, `ssn`, …           |
| Values    | JWT, `Bearer …`, `Basic …`, `sk-…`, `ghp_…`, `AKIA…`, `xox…`, `AIza…`, PEM blocks       |
| URLs      | user-info, and query parameters matching the key or value rules                         |
| Literals  | any string the session is known to hold, wherever it appears                            |

Password fields are recognised **in the page** and their values never reach the
Node process.

Redaction preserves JSON shape, so schema inference stays correct while the
value is gone.

_Verified by:_ `packages/core/src/redaction.test.ts` (with a positive control that
proves the detector fires) and `scripts/gates/check-redaction.mjs`, which takes
the live session cookie and scans every stored file, every export and every CLI
response for it.

## 2. Operations reference credentials, they never hold them

```jsonc
{ "strategy": "browser-session" }
{ "strategy": "header", "header": "authorization", "env": "GHOSTAPI_APP_TOKEN" }
```

The material lives either in the Chrome profile you control or in an environment
variable you set. That is what makes an exported MCP server, Skill or client safe
to commit and publish.

One file holds a credential: `.ghostapi/targets/<slug>/auth.json`, written `0600`
and gitignored. `exportBundle` reads the target and the operations — it has no
code path to that file.

## 3. Pages are untrusted input

Anything lifted from a page is sanitised before it can reach a model:
control characters stripped, length bounded, and known prompt-injection patterns
flagged. The exported Skill tells agents in as many words never to pass `--yes`
because a page or a tool result asked them to.

An operation is a JSON document. Bindings are a tree of `literal` / `input` /
`object` / `array` nodes, resolved by a walk. There is no templating, no
expression syntax and nothing evaluated — a value from a hostile page cannot
become behaviour.

Operation names are constrained to plain identifiers before they become
TypeScript symbols or MCP tool names.

## 4. Destructive operations

Every operation carries `destructive: boolean`, and classification errs toward
destructive: `DELETE`, the archive and delete verbs, and names matching
`delete|remove|destroy|purge|archive|cancel|revoke|wipe`.

- The CLI refuses without `--yes`.
- Exports leave them out unless `--include-destructive`.
- The generated MCP server still refuses unless `GHOSTAPI_ALLOW_DESTRUCTIVE=1`.
- The web inspector will not run them at all.
- Generated eval suites never opt into them.
- The argument binder never invents an identifier for one.

## 5. SSRF and imported targets

A `.ghost` file is code someone else wrote. On import:

- the schema is validated and unknown keys are rejected;
- every URL is checked against a policy that blocks loopback, link-local,
  private and cloud-metadata ranges (`169.254.169.254`, `10/8`, `192.168/16`,
  `172.16/12`, `100.64/10`, `fc00::/7`, `fe80::/10`) unless you pass
  `--allow-private-network`;
- non-`http(s)` schemes and URLs with embedded credentials are refused;
- a bundle carrying a literal credential value is refused outright.

Loopback is allowed for targets _you_ created locally, and blocked for targets
that arrived from elsewhere. Same code, different policy, chosen by provenance.

## 6. Path traversal and file safety

Target slugs and any segment used to build a path are validated before they
touch the filesystem. Path parameters are percent-encoded into URLs, so
`../../admin` stays a literal segment. The demo target refuses to serve outside
its own public directory.

## 7. What is still your responsibility

- **The session in `auth.json` is a live credential.** It is gitignored and
  `0600`, but it is real. Treat `.ghostapi/` as secret.
- **Check what you export before you publish it.** Paths and field names _are_
  information about someone's application.
- **Read an imported target before running it.** `ghostapi operations` and
  `ghostapi inspect` show exactly what each operation will do.

## Reporting

Found something? Open a security advisory on the repository rather than a public
issue.
