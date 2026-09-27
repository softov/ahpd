---
title: http.host binds the API's own listener
status: done
depends: []
layer: "server"
refs:
  - "[decisions/http-host-binds-the-apis-own-listener.md](../../../decisions/http-host-binds-the-apis-own-listener.md) - what this task applies"
  - "[code://packages/server/src/config.ts#L8-L24](../../../../packages/server/src/config.ts#L8-L24) - `HttpSetting`, which now has `host`"
  - "[code://packages/server/src/commands/options.ts#L280-L311](../../../../packages/server/src/commands/options.ts#L280-L311) - `httpOf`, which reads and validates it"
  - "[code://packages/server/src/commands/run.ts#L193-L195](../../../../packages/server/src/commands/run.ts#L193-L195) and [#L236-L238](../../../../packages/server/src/commands/run.ts#L236-L238) - `apiHost`, and `listenApi` bound to it"
  - "[code://packages/server/src/commands/run.ts#L521](../../../../packages/server/src/commands/run.ts#L521) - the `http on` line, which names the bound host"
  - "[code://packages/server/test/server-http.test.ts#L365-L404](../../../../packages/server/test/server-http.test.ts#L365-L404) - the four cases"
---

## Objective

`{ "http": { "port": N, "host": "127.0.0.1" } }` binds the API's own listener to that address whatever the daemon's `host` is, and the startup line names it.

## Files

- `UPDATE: packages/server/src/config.ts:8-24` - `HttpSetting` gains `host`.
- `UPDATE: packages/server/src/commands/options.ts:280-311` - `httpOf` reads `host`; a non-string, or a `host` without a `port`, refuses the start (decision `http-host-binds-the-apis-own-listener`).
- `UPDATE: packages/server/src/commands/run.ts:193-195, 236-238, 521` - `apiHost` is what `listenApi` binds and what the `http on` line names.
- `UPDATE: packages/server/test/server-http.test.ts:46-49, 115-126, 365-404` - the daemon fixture reads the announced hosts, and the four cases.

## Steps

1. The key, its validation and the bind.
2. The startup line and the origins of task 11 use the bound host.

## Validation

- `packages/server/test/server-http.test.ts`: `--host 0.0.0.0 --connection-token t` with `{ "http": { "port": 0, "host": "127.0.0.1" } }` prints `http on http://127.0.0.1:<n>/api` and the API answers there; today the API is on `0.0.0.0`.
- `{ "http": { "host": "127.0.0.1" } }` exits 2.
- `{ "http": { "port": 0, "host": 5 } }` exits 2.

## Resume

Done.
`HttpSetting` carries `host`, `httpOf` refuses a non-string one and one with no `port` to bind, and `run.ts` binds the API's own listener to `http.host ?? options.host` and names that host on the `http on` line.
The test fixture now reads the announced host as well as the port, so a daemon on `0.0.0.0` can be started by a case.
`pnpm typecheck` green; `packages/server/test/server-http.test.ts` green, 19 cases.
