---
title: A daemon with no token and no users refuses to start with http on
status: todo
depends: []
layer: "server"
refs:
  - "[decisions/an-unconfigured-daemon-does-not-serve-the-http-api.md](../../../decisions/an-unconfigured-daemon-does-not-serve-the-http-api.md) - what this task applies"
  - "[code://packages/server/src/commands/run.ts#L148-L153](../../../../packages/server/src/commands/run.ts#L148-L153) - the startup refusals `http` already has"
  - "[code://packages/server/src/commands/authorize.ts#L64-L73](../../../../packages/server/src/commands/authorize.ts#L64-L73) - the branch that admits every request on such a host"
---

## Objective

`http` on with neither a connection token nor a user directory stops the daemon at startup with exit code 2 and a sentence naming `--connection-token`, `--connection-token-file` and `--users`.
`authorizeOverHttp` never admits a request that carries no credential.

## Files

- `UPDATE: packages/server/src/commands/run.ts:148-153` - after `secret(options)`, refuse `http` when `token` and `users` are both absent; this covers `--without-connection-token` too.
- `UPDATE: packages/server/src/commands/authorize.ts:64-73` - the `options.token === undefined` admit goes; with no directory a request without the deployment token is 401.
- `UPDATE: test/server-http.test.ts:155-180` - the three `http in the configuration` cases start a daemon with no token and would now be refused; they pass `--connection-token` and send it.

## Steps

1. The startup refusal, in the same place as the `--stdio` one (decision `an-unconfigured-daemon-does-not-serve-the-http-api`).
2. Remove the admit branch and its comment from `authorizeOverHttp`.

## Validation

- `test/server-http.test.ts`: `{ "http": true }` with no token and no `users` exits 2 with the sentence; today it starts, and a form-encoded `POST /api/user/add/mallory` with no credentials writes a users file.
- `{ "http": true }` with `--without-connection-token` exits 2.
- `{ "http": true }` with `--users <file>` and no token starts.
- The existing cases pass with their token.

## Resume
