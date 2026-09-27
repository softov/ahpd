---
title: The daemon's listener survives a malformed request, with the API on or off
status: done
depends: []
layer: "server | sdk"
refs:
  - "[code://packages/server/src/http.ts#L127-L158](../../../../packages/server/src/http.ts#L127-L158) - `REQUEST_UNREADABLE` and `guarded`, the check both handlers go through"
  - "[code://packages/server/src/http.ts#L81-L125](../../../../packages/server/src/http.ts#L81-L125) - `apiHandler` and `withoutApi`, both wrapped"
  - "[code://packages/server/src/http.ts#L190-L192](../../../../packages/server/src/http.ts#L190-L192) - `pathOf`, which is what can throw on a malformed `Host`"
  - "[code://packages/sdk/src/listen.ts#L274-L293](../../../../packages/sdk/src/listen.ts#L274-L293) - where the handler is attached, and the two shapes as they are"
  - "[code://packages/server/src/commands/run.ts#L233-L235](../../../../packages/server/src/commands/run.ts#L233-L235) - `daemonRequest`, passed on Node whether `http` is on or not"
  - "[code://packages/server/test/server-http.test.ts#L194-L238](../../../../packages/server/test/server-http.test.ts#L194-L238) - `raw` and the three cases"
---

## Objective

A request with a malformed `Host` or a malformed percent-escape in its path is answered 400 by every Node daemon, and the daemon keeps running.
This holds with `http` off, which is every daemon today, and with it on while ahpd still runs `@cofold/remote@0.3.0`.

## Files

- `UPDATE: packages/server/src/http.ts:127-158` - `guarded`, the one check `apiHandler` and `withoutApi` both go through: the URL is built and every path segment decoded before a route sees it, and a handler that throws is answered.
- `UPDATE: packages/server/src/http.ts:81-125` - `apiHandler` wraps `serve()`, and `withoutApi` takes the validated path.
- `UPDATE: packages/server/src/http.ts:109-115` - the `withoutApi` comment says what the handler answers.
- `UPDATE: packages/sdk/src/listen.ts:274-283` - the comment documents the two shapes as they are.
- `UPDATE: packages/server/test/server-http.test.ts:194-238` - the cases below.

## Steps

1. One guard in `http.ts` that both handlers go through: a URL that does not parse, or a pathname whose `decodeURIComponent` throws, is answered 400 with a JSON sentence before anything else runs.
2. `withoutApi` and `apiHandler` use it, and nothing in either can throw out of the `request` listener.
3. Rewrite the two comments so they say what the code is, with no history.

## Validation

- `packages/server/test/server-http.test.ts`: with `http` off, a raw `GET /api/status` over `node:net` with `Host: a b` answers 400 and a following request to the same port still answers; today the daemon exits 1 with `ERR_INVALID_URL`.
- The same with `http: true`.
- With `http: true` and a token, `POST /api/user/add/%E0%A4%A` with no `Authorization` answers 400 and the daemon keeps running; today it exits 1.
- `pnpm typecheck` green.

## Resume

Done.
`guarded` is the one check both handlers go through: `pathOf` and `decodeURIComponent` run first, and a `Host` or a path that does not parse is answered 400 with a JSON sentence. A handler that throws is answered rather than allowed to end the process.
The three cases write raw bytes over `node:net`, because no client library will send `Host: a b` or `%E0%A4%A`; each verifies the 400 and that the daemon answers the next request.
`pnpm typecheck` green; `packages/server/test/server-http.test.ts -t "a malformed request"` green, 3 cases.
