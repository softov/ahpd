---
title: A daemon with no token and no users refuses to start with http on
status: done
depends: []
layer: "server"
refs:
  - "[decisions/an-unconfigured-daemon-does-not-serve-the-http-api.md](../../../decisions/an-unconfigured-daemon-does-not-serve-the-http-api.md) - what this task applies"
  - "[code://packages/server/src/commands/run.ts#L179-L195](../../../../packages/server/src/commands/run.ts#L179-L195) - the startup refusals `http` has, the credential one included"
  - "[code://packages/server/src/commands/authorize.ts#L61-L87](../../../../packages/server/src/commands/authorize.ts#L61-L87) - the hook, which now always has a token or a directory behind it"
  - "[code://packages/server/test/server-http.test.ts#L330-L349](../../../../packages/server/test/server-http.test.ts#L330-L349) - the three cases"
---

## Objective

`http` on with neither a connection token nor a user directory stops the daemon at startup with exit code 2 and a sentence naming `--connection-token`, `--connection-token-file` and `--users`.
`authorizeOverHttp` never admits a request that carries no credential.

## Files

- `UPDATE: packages/server/src/commands/run.ts:179-195` - after `secret(options)`, refuse `http` when `token` and `users` are both absent; this covers `--without-connection-token` too.
- `UPDATE: packages/server/src/commands/authorize.ts:61-87` - the `options.token === undefined` admit goes; with no directory a request without the deployment token is 401.
- `UPDATE: packages/server/test/server-http.test.ts:303-350` - the three `http in the configuration` cases pass a token, and the three new cases cover the refusals and the directory that needs none.

## Steps

1. The startup refusal, in the same place as the other `http` refusals (decision `an-unconfigured-daemon-does-not-serve-the-http-api`).
2. Remove the admit branch and its comment from `authorizeOverHttp`.

## Validation

- `packages/server/test/server-http.test.ts`: `{ "http": true }` with no token and no `users` exits 2 with the sentence; today it starts, and a form-encoded `POST /api/user/add/mallory` with no credentials writes a users file.
- `{ "http": true }` with `--without-connection-token` exits 2.
- `{ "http": true }` with `--users <file>` and no token starts.
- The existing cases pass with their token.

## Resume

Done.
The startup refusal sits with the other `http` ones and names all three ways to give the daemon a credential, so `--without-connection-token` with `http` is refused as well.
`authorizeOverHttp` no longer has a branch that returns without a caller: with no directory a request without the deployment token is 401.
The three `http in the configuration` cases pass `--connection-token` and send it, because the manifest route is open but the daemon itself is not.
`pnpm typecheck` green; `packages/server/test/server-http.test.ts` green, 16 cases.
