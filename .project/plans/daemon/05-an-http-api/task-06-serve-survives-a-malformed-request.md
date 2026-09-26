---
title: "`serve()` survives a malformed request and takes only JSON bodies (cofold repository)"
status: done
depends: []
layer: "cofold remote"
refs:
  - file:///github/cofold/packages/remote/src/serve.ts - the handler, uncommitted in the cofold repository
  - file:///github/cofold/packages/remote/src/serve.test.ts - its tests
  - "[decisions/the-http-api-checks-origin-and-host-and-takes-only-json.md](../../../decisions/the-http-api-checks-origin-and-host-and-takes-only-json.md) - JSON bodies only"
  - "[decisions/cofold-remote-0-3-1-is-cut-by-softov-from-a-tagged-commit.md](../../../decisions/cofold-remote-0-3-1-is-cut-by-softov-from-a-tagged-commit.md) - who releases it"
---

## Objective

No request can end the process that runs `serve()`: a malformed `Host`, a malformed percent-escape and a failing command are all answered with a status.
A body is read only as `application/json`, and an error that is not a deliberate refusal is answered with a sentence that carries none of its message.

## Files

- `UPDATE: /github/cofold/packages/remote/src/serve.ts:87-133` - the handler: `new URL(...)` at line 89 and `match(...)` at line 105 run outside the `try`, inside a `void` async function, so a throw is an unhandled rejection and Node ends the process.
- `UPDATE: /github/cofold/packages/remote/src/serve.ts:144-158` - `match`: `decodeURIComponent` at line 152 throws `URIError` on `%E0%A4%A`, before `authorize` is asked.
- `UPDATE: /github/cofold/packages/remote/src/serve.ts:169-190` - `readBody`: accepts `application/x-www-form-urlencoded` (lines 181-183) and parses any other type as JSON (lines 184-189).
- `UPDATE: /github/cofold/packages/remote/src/serve.ts:208-222` - `describe` and `messageOf`: line 221 returns any `Error`'s message, so a 500 carried "`<path>` could not be read: Unexpected token 'T', \"TOPSECRET-\"... is not valid JSON" to the caller.
- `UPDATE: /github/cofold/packages/remote/src/serve.test.ts` - the cases below.

## Steps

1. Parse the URL inside the handler's error path: a `Host` or URL that does not parse is answered 400 with a sentence, and the handler's promise ends in a `catch` that answers 500 when nothing has been sent, so no rejection escapes.
2. In `match`, a path segment whose `decodeURIComponent` throws is answered 400, not a crash.
3. In `readBody`, a request with a body whose `content-type` is not `application/json` is refused with `HttpError(415)`; the form-encoded branch goes (decision `the-http-api-checks-origin-and-host-and-takes-only-json`).
4. In `messageOf`, an error that is not an expected `CofoldError`, not an `HttpError` and carries no numeric `status` answers `"Failed"`, never its own message.
5. `npm run check` in `/github/cofold`.
6. Commit, tag and publish are Softov's (decision `cofold-remote-0-3-1-is-cut-by-softov-from-a-tagged-commit`): leave the change uncommitted in `/github/cofold`, say in Resume that it is ready for 0.3.1, and do not run `npm publish`.
7. After Softov has published 0.3.1, move `@cofold/remote` in `packages/server/package.json` to `^0.3.1`; until then task 07's guard in ahpd covers the daemon.

## Validation

- `serve.test.ts`: a raw request over `node:net` with `Host: a b` answers 400 and the same server answers a following request; today the process ends with `ERR_INVALID_URL`.
- `serve.test.ts`: `POST /add/%E0%A4%A` on a route with a `{id}` parameter answers 400 and `authorize` is not asked; today it is an unhandled `URIError`.
- `serve.test.ts`: a `POST` with `content-type: application/x-www-form-urlencoded` and one with `text/plain` both answer 415; today the first runs the command and the second is parsed as JSON.
- `serve.test.ts`: a command that throws `new Error('/secret/path could not be read')` answers 500 with `{ "message": "Failed" }`; today the message is returned.
- `npm run check` in `/github/cofold` green.

## Resume

Done, with decision `serve-hands-the-principal-to-the-registry-as-actor` in the same change. Released 2026-09-26 from `/github/cofold` by its `release.yml` as `@cofold/remote@0.3.1`, after `npm run check` in `/github/cofold` passed (826 tests).

- Step 1: `urlOf` (`src/serve.ts:152`) returns `null` for a URL or `Host` that does not parse, answered 400 at `src/serve.ts:90`; the handler's promise ends in a `.catch` (`src/serve.ts:144`) that answers 500 "Failed" when nothing was sent and destroys the socket otherwise.
- Step 2: `match` is called in a `try` (`src/serve.ts:112`); a `URIError` from `decodeURIComponent` answers 400 before `authorize` is asked.
- Step 3: `readBody` refuses a non-empty body whose `content-type` is not `application/json` with `HttpError(415)` (`src/serve.ts:212`); the form-encoded branch is gone. An empty body still passes as `{}`.
- Step 4: `messageOf` (`src/serve.ts:253`) answers the message only for an expected `CofoldError`, an `HttpError`, or an `Error` with a numeric `status`; anything else is "Failed". `describe` also no longer throws on a thrown `null`.
- Actor: `ServeOptions.authorize` returns `unknown` (`src/serve.ts:58`), and its answer is passed as `request.actor` to `registry.execute` (`src/serve.ts:120`, `:132`). `RequestContext.actor?: unknown` already existed in `@cofold/commands` (`packages/commands/src/types/context.ts:12`), so that package is unchanged.
- `packages/remote/package.json` version is `0.3.1`.
- Tests: six cases in `src/serve.test.ts:224-282` (raw `node:net` request with `Host: a b` then a following request; `POST /add/%E0%A4%A` with `authorize` not asked; form and `text/plain` bodies answer 415; `new Error('/secret/path could not be read')` answers `{ "message": "Failed" }`; a command sees the actor `authorize` returned; the actor is absent without `authorize`). Five failed before the fix, for the named reasons: unhandled `ERR_INVALID_URL` and `URIError` rejections, 200 for the form body, the secret message returned, `null` actor.

Verified in `/github/cofold`: `node_modules/.bin/vitest run packages/remote` 6 files, 57 tests passed, no type errors; in `packages/remote`, `tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.test.json` clean.

Not known to the plan: step 5's `npm run check` runs `pnpm build` over every package, a repo-wide rebuild that the agents working in other cofold packages at the same time could not share, so it was not run; Softov runs it before the release. `ROADMAP.md`'s `serve` paragraph stays true and was not changed.

Step 7: `packages/server/package.json` takes `@cofold/remote` `^0.3.1`, excluded from the minimum release age in `pnpm-workspace.yaml`.
