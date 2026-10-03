---
title: The listener serves a plugin's route under /plugins/<name>/
status: todo
depends: [task-01-register-route-is-a-kind.md]
layer: "sdk listen, server"
refs:
  - "[code://packages/sdk/src/types/listen.ts#L99-L112](../../../../packages/sdk/src/types/listen.ts#L99-L112) - the plain-request handler"
  - "[code://packages/server/src/commands/run.ts#L341-L342](../../../../packages/server/src/commands/run.ts#L341-L342) - `daemonRequest`, the chain a route joins"
  - "[code://packages/server/src/commands/run.ts#L607](../../../../packages/server/src/commands/run.ts#L607) - `loadPlugins`, after `daemonRequest` is built"
  - "[code://packages/server/src/commands/run.ts#L687](../../../../packages/server/src/commands/run.ts#L687) - `plainRequests(daemonRequest)`, which the listener always gets"
  - "[code://packages/server/src/commands/run.ts#L74-L86](../../../../packages/server/src/commands/run.ts#L74-L86) - `apiOrigins`, which the open question is about"
  - "[code://.project/plans/daemon/05-an-http-api/task-15-serve-takes-a-request.md](../../daemon/05-an-http-api/task-15-serve-takes-a-request.md) - must be done first"
  - "[code://.project/plans/daemon/05-an-http-api/task-16-the-api-on-bun-and-deno.md](../../daemon/05-an-http-api/task-16-the-api-on-bun-and-deno.md) - must be done first"
  - "[code://.project/plans/daemon/05-an-http-api/task-11-origin-and-host-are-checked.md](../../daemon/05-an-http-api/task-11-origin-and-host-are-checked.md) - the Host check to share"
---

## Objective

A plain request under `/plugins/<name>/` reaches that plugin's handler as a `Request` and is answered with its `Response`, on every runtime and whether `http` is on or off.

## Files

- `UPDATE: packages/server/src/commands/run.ts:341-342` - `daemonRequest` tries the tools servers, then a plugin route, then what is below; the route is looked up per request in the fold `loadPlugins` makes at line 607, through a variable assigned once the fold exists.
- `CREATE: packages/server/test/plugin-route.test.ts` - the cases below.

## Steps

1. The listener already gets `plainRequests(daemonRequest)` with `http` on or off (`run.ts:687`), and daemon 05 tasks 15 and 16 made it a `Request` on Node, Bun and Deno; nothing changes in `listen.ts`.
2. `/api` goes to the API as today; a path under task 01's prefix, matched by whole segments, to that plugin's handler; any other path answers as it does now.
3. The Host check before a route runs waits on the plan's open question; do not apply Origin or the JSON-only check.
4. A handler that throws answers 500 with a sentence and is reported against its plugin; the daemon keeps running.

## Validation

- `packages/server/test/plugin-route.test.ts`: a route answers with `http` off and on; `Host` is checked as the open question settles; `/plugins/%40ahpd/xy` does not reach `@ahpd/x`; a form body with no `Origin` reaches the route; a throwing handler answers 500 and the next request is served; an unknown plugin name answers 404.
- `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.

## Resume

