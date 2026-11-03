---
title: A plain request tests the token
domain: host
status: active
priority: medium
created: 2026-10-16
revalidated: 2026-10-16
changes: []
creates: []
refs:
  - "[code://packages/sdk/src/listen.ts#L47-L55](../../../../packages/sdk/src/listen.ts#L47-L55) - `presented`: the token from `?tkn=` or a `Bearer` header"
  - "[code://packages/sdk/src/listen.ts#L102-L126](../../../../packages/sdk/src/listen.ts#L102-L126) - `identityOf`, the check the handshake uses"
  - "[code://packages/sdk/src/listen.ts#L141-L152](../../../../packages/sdk/src/listen.ts#L141-L152) - Bun: a refused handshake is 401, a plain request is 426"
  - "[code://packages/sdk/src/listen.ts#L209-L212](../../../../packages/sdk/src/listen.ts#L209-L212) - Deno: the same two answers"
  - "[code://packages/sdk/src/listen.ts#L285-L302](../../../../packages/sdk/src/listen.ts#L285-L302) - Node: the 401 from `verifyClient`, and the 426 of a host with no HTTP surface"
  - "[code://packages/server/src/http.ts#L142-L149](../../../../packages/server/src/http.ts#L142-L149) - `withoutApi`, the daemon's 426"
  - "[code://packages/server/src/commands/run.ts#L456-L471](../../../../packages/server/src/commands/run.ts#L456-L471) - the chain of plain request handlers on the daemon's port"
  - "[code://packages/server/test/server-http.test.ts#L486-L492](../../../../packages/server/test/server-http.test.ts#L486-L492) - the test of the 404 under `/api` and the 426 elsewhere"
  - "[code://packages/server/src/config.ts#L157-L165](../../../../packages/server/src/config.ts#L157-L165) - `origins`, which the API checks and this answer does not"
---

## Goal

A plain `GET` with a token tells a client whether this host accepts the token.
A refused token gets 401, and an accepted one gets 426.
A browser page on any origin can read the answer, so ahpw can test a token at sign-in and when its connection keeps failing.
ahpw runs from ahpd as a plugin, from 127.0.0.1, from a remote server and in Tauri, so the origin is not known.

## Reconnaissance

### Searches performed

- `git grep -n "426" packages/server/src packages/sdk/src` - the 426 is in `listen.ts` for each runtime and in `withoutApi`.
- `git grep -in "access-control-allow-origin" packages/` - ahpd sends the header nowhere.

### What is true now

- A WebSocket handshake with a wrong token gets 401, and a browser cannot read that status.
- A plain request gets 426 whatever token it carries, so a client cannot tell a wrong token from a host that is down.
- A WebSocket is not held to CORS, and the handshake does not check `Origin`.
- On the daemon, a plain request off `/api` and `/v1` reaches `withoutApi` or the API's handler, not the 426 in `listen.ts`.

### Gaps

- The answer outside `/api` when `http` is on is not read yet. Task 01 reads it and gives it the same two answers.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A plain request that the handshake would refuse gets 401, with the handshake's sentence | Softov, 2026-10-16, asked about the plan and chose "Plan it" | 01, 02 |
| A plain request that the handshake would accept gets 426, as now | Softov, 2026-10-16, the same answer | 01, 02 |
| The 401 and the 426 carry `Access-Control-Allow-Origin: *` | Softov, 2026-10-16, chose `*` over the `origins` list, because ahpw runs from origins nobody lists | 01, 02 |
| `/api` and `/v1` keep their own answers and their `origins` check | Softov, 2026-10-16, the same answer | 01 |
| The token goes in `?tkn=`, so the request is a simple request and needs no preflight | (defaulted: `presented` reads it, and a `Bearer` header needs an `OPTIONS` answer) | 01, 02 |
| One function checks the token for the handshake and for the plain request | (defaulted: the two answers must never disagree) | 01, 02 |

## Proposed architecture

- **Data flow:** a plain request off `/api` and `/v1` -> the token check of the handshake -> 401 or 426, each with the header.
- **Layer responsibilities:** sdk: `listen` gives the two answers on each runtime and exports the check. server: `withoutApi` uses the same check.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A host answers a plain request by its token](task-01-a-host-answers-plain-request-by-token.md) | implemented | - |
| [02 - The docs say how to test a token](task-02-the-docs-say-how-to-test-a-token.md) | implemented | 01 |

## Risks and tradeoffs

- Any page can read whether a token works. It can learn the same today from a WebSocket that opens or not, so the answer gives nothing new.
- `*` is without credentials, so the browser sends no cookie, and ahpd reads none.

## Resume state

- **Done so far:** planned 2026-10-16. Task 01 implemented 2026-10-16: `doorOf` and `plainAnswer` in the sdk, and `withoutApi` on the daemon's port. Task 02 implemented 2026-10-16: `Test a token` in `docs/server/REMOTE.md`, and one sentence in `docs/sdk/AHP.md`. Both reviewed 2026-10-16.
- **Next action:** none by hand. The browser check passed on 2026-11-03.
- **Open questions:** none.
- **Watch out for:** a host with no token admits every request, so it answers 426 to every plain request.

## Final verification checklist

- [ ] A test on each runtime path: a wrong token gets 401, a good one 426, and no token 401 when the host has a token.
- [ ] A test: both answers carry `Access-Control-Allow-Origin: *`, and `/api` does not.
- [ ] The gates pass: build, typecheck, boundary, schema and vitest.
- [x] By hand: ahpw on another origin reads the 401 from a browser. Checked on 2026-11-03 with `curl` and `Origin: https://example.com`: 401 and 426, each with `Access-Control-Allow-Origin: *`.
