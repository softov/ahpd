---
title: The daemon's listener survives a malformed request, with the API on or off
status: todo
depends: []
layer: "server | sdk"
refs:
  - "[code://packages/server/src/http.ts#L53-L82](../../../../packages/server/src/http.ts#L53-L82) - `apiHandler` and `withoutApi`, the two handlers a listener carries"
  - "[code://packages/server/src/http.ts#L114-L116](../../../../packages/server/src/http.ts#L114-L116) - `pathOf`, which throws on a malformed `Host`"
  - "[code://packages/sdk/src/listen.ts#L274-L294](../../../../packages/sdk/src/listen.ts#L274-L294) - where the handler is attached, and the comment about the unchanged path"
  - "[code://packages/server/src/commands/run.ts#L160-L163](../../../../packages/server/src/commands/run.ts#L160-L163) - `daemonRequest`, passed on Node whether `http` is on or not"
---

## Objective

A request with a malformed `Host` or a malformed percent-escape in its path is answered 400 by every Node daemon, and the daemon keeps running.
This holds with `http` off, which is every daemon today, and with it on while ahpd still runs `@cofold/remote@0.3.0`.

## Files

- `UPDATE: packages/server/src/http.ts:114-116` - `pathOf` builds `new URL(..., 'http://' + Host)`, which throws synchronously in the `request` listener; with `http` off a `Host: a b` request ends the daemon with exit 1.
- `UPDATE: packages/server/src/http.ts:53-62` - `apiHandler`: wraps `serve()` with the same guard, so `POST /api/user/add/%E0%A4%A` with no credentials no longer reaches the crash in `serve.ts` (task 06).
- `UPDATE: packages/server/src/http.ts:64-71` - the `withoutApi` comment says "the path the whole task is about", which narrates the plan; it documents what the handler answers instead.
- `UPDATE: packages/sdk/src/listen.ts:274-284` - the comment says the port path "is the literal one it has always been", which is not what a Node daemon runs, since `run.ts:163` always passes a handler; it documents the two shapes as they are.
- `UPDATE: test/server-http.test.ts` - the cases below.

## Steps

1. One guard in `http.ts` that both handlers go through: a URL that does not parse, or a pathname whose `decodeURIComponent` throws, is answered 400 with a JSON sentence before anything else runs.
2. `withoutApi` and `apiHandler` use it, and nothing in either can throw out of the `request` listener.
3. Rewrite the two comments so they say what the code is, with no history.

## Validation

- `test/server-http.test.ts`: with `http` off, a raw `GET /api/status` over `node:net` with `Host: a b` answers 400 and a following request to the same port still answers; today the daemon exits 1 with `ERR_INVALID_URL`.
- The same with `http: true`.
- With `http: true` and a token, `POST /api/user/add/%E0%A4%A` with no `Authorization` answers 400 and the daemon keeps running; today it exits 1.
- `pnpm typecheck` green.

## Resume
