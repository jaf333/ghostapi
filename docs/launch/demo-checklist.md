# Demo checklist

Run top to bottom before recording or presenting. Anything unchecked is a reason
not to record yet.

## Environment

- [ ] `node scripts/gates/check-build.mjs` → `GATE_G1_BUILD_OK`
- [ ] `pnpm test` → all suites pass
- [ ] `ghostapi doctor` → every check green
- [ ] Chrome is the version you will demo with; quit other Chrome windows
- [ ] `TYPESAFE_API_KEY` / `AI_GATEWAY_API_KEY` set or _deliberately_ unset —
      decide which engine the demo shows and say so on screen
- [ ] Clean workspace: `rm -rf /tmp/demo && mkdir /tmp/demo && cd /tmp/demo`

## Numbers

- [ ] `node scripts/measure-demo.mjs` re-run **today**
- [ ] `docs/benchmark-results.json` regenerated
- [ ] README figures match that file (`node scripts/gates/check-docs.mjs`)
- [ ] Captions in the video script match the same file

## The flow, rehearsed

- [ ] `node apps/demo-target/dist/server.js` is running
- [ ] `ghostapi open http://127.0.0.1:4123` opens and the login screen appears
- [ ] Sign in works first time (credentials `demo@ghostapi.dev` / `ghost`)
- [ ] Creating a todo shows the request in the network feed within a second
- [ ] Closing the window prints ≥ 5 operations
- [ ] `ghostapi inspect createTodo` shows the priority enum and ≥ 90% confidence
- [ ] `ghostapi run createTodo '{"title":"Buy bread","projectId":"prj_home","priority":"high"}'` → 201
- [ ] `ghostapi ask "create a todo called buy coffee"` → 201
- [ ] `ghostapi export mcp` → then actually start the server once
- [ ] `ghostapi benchmark createTodo '…' --runs 5` → speed-up over 50×

## Recording

- [ ] Terminal ~90 columns, 16px, dark, no transparency
- [ ] Shell prompt shortened to `$`
- [ ] Notifications off, Do Not Disturb on
- [ ] No real credentials, no company names, no internal hostnames on screen
- [ ] The demo target only — never record against a third-party site

## Before posting

- [ ] Repo is public and `git status` is clean
- [ ] `.ghostapi/` is **not** committed (it holds your session)
- [ ] LICENSE present
- [ ] README first viewport reads well on a phone
- [ ] Video uploaded natively to the platform, not as a link
- [ ] Someone outside the project followed the README and got to a 201
