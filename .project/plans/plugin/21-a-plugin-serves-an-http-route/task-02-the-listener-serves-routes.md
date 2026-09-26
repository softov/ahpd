---
title: The listener serves a plugin's route under /plugins/<name>/
status: todo
depends: [task-01-register-route-is-a-kind.md]
layer: "sdk listen, server"
refs:
  - "[code://packages/sdk/src/types/listen.ts#L95-L109](../../../../packages/sdk/src/types/listen.ts#L95-L109) - the plain-request handler"
  - "[code://packages/server/src/commands/run.ts](../../../../packages/server/src/commands/run.ts) - where the daemon hands the listener its handler"
  - "[code://.project/plans/daemon/05-an-http-api/task-15-serve-takes-a-request.md](../../daemon/05-an-http-api/task-15-serve-takes-a-request.md) - must be done first"
  - "[code://.project/plans/daemon/05-an-http-api/task-16-the-api-on-bun-and-deno.md](../../daemon/05-an-http-api/task-16-the-api-on-bun-and-deno.md) - must be done first"
  - "[code://.project/plans/daemon/05-an-http-api/task-11-origin-and-host-are-checked.md](../../daemon/05-an-http-api/task-11-origin-and-host-are-checked.md) - the Host check to share"
---

## Objective

A plain request under `/plugins/<name>/` reaches that plugin's handler as a `Request` and is answered with its `Response`, on every runtime and whether `http` is on or off.

## Files

- `UPDATE: packages/server/src/commands/run.ts` - the daemon passes a plain-request handler whenever a route or the API exists, and routes by prefix.
- `CREATE: test/plugin-route.test.ts` - the cases below.

## Steps

1. Wait for daemon 05 tasks 15 and 16, so the listener's plain request is a `Request` on Node, Bun and Deno.
2. `/api` goes to the API as today; `/plugins/<name>/...` to that plugin's handler; any other path answers as the listener does now.
3. Apply the Host check before a route runs; do not apply Origin or the JSON-only check.
4. A handler that throws answers 500 with a sentence and is reported against its plugin; the daemon keeps running.

## Validation

- `test/plugin-route.test.ts`: a route answers with `http` off and on; a foreign `Host` is refused 403; a form body with no `Origin` reaches the route; a throwing handler answers 500 and the next request is served; an unknown plugin name answers 404.
- `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.

## Resume

