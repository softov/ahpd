---
title: http.host binds the API's own listener
status: todo
depends: []
layer: "server"
refs:
  - "[decisions/http-host-binds-the-apis-own-listener.md](../../../decisions/http-host-binds-the-apis-own-listener.md) - what this task applies"
  - "[code://packages/server/src/config.ts#L8-L20](../../../../packages/server/src/config.ts#L8-L20) - `HttpSetting`"
  - "[code://packages/server/src/commands/options.ts#L243-L262](../../../../packages/server/src/commands/options.ts#L243-L262) - `httpOf`, which reads it"
---

## Objective

`{ "http": { "port": N, "host": "127.0.0.1" } }` binds the API's own listener to that address whatever the daemon's `host` is, and the startup line names it.

## Files

- `UPDATE: packages/server/src/config.ts:8-20` - `HttpSetting` gains `host`.
- `UPDATE: packages/server/src/commands/options.ts:243-262` - `httpOf` reads `host`; a non-string, or a `host` without a `port`, refuses the start (decision `http-host-binds-the-apis-own-listener`).
- `UPDATE: packages/server/src/commands/run.ts:164-166` - `listenApi` binds `http.host ?? options.host`; today always `options.host`.
- `UPDATE: packages/server/src/commands/run.ts:449` - the `http on` line names the host the API is bound to; today it prints `options.host`.
- `UPDATE: test/server-http.test.ts` - the cases below.

## Steps

1. The key, its validation and the bind.
2. The startup line and the origins of task 11 use the bound host.

## Validation

- `test/server-http.test.ts`: `--host 0.0.0.0 --connection-token t` with `{ "http": { "port": 0, "host": "127.0.0.1" } }` prints `http on http://127.0.0.1:<n>/api` and the API answers there; today the API is on `0.0.0.0`.
- `{ "http": { "host": "127.0.0.1" } }` exits 2.
- `{ "http": { "port": 0, "host": 5 } }` exits 2.

## Resume
