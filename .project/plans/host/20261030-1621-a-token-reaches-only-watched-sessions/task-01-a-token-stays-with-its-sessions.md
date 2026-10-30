---
title: A token stays with its connection's sessions
status: done
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/auth.ts#L23-L52](../../../../packages/sdk/src/host/auth.ts#L23-L52) - `asking`"
  - "[code://packages/sdk/src/host/auth.ts#L165-L178](../../../../packages/sdk/src/host/auth.ts#L165-L178) - `channelAwaiting`"
  - "[code://packages/sdk/src/host/handshake.ts#L145-L240](../../../../packages/sdk/src/host/handshake.ts#L145-L240) - `expire` and `aimedAt`"
  - "[code://packages/sdk/src/host/handshake.ts#L633-L813](../../../../packages/sdk/src/host/handshake.ts#L633-L813) - `authenticate`"
---

## Objective

A token reaches only the sessions its connection watches, under any spelling, with or without a target.
`auth/required` reaches every connection that watches the session, under the name it watches it by.

## Files

- `UPDATE: packages/sdk/src/host/auth.ts:9-18` - `Auth` gains `watchedAs`, and `channelAwaiting` takes the connection.
- `UPDATE: packages/sdk/src/host/auth.ts:23-52` - `asking` tells each watcher under its own spelling.
- `UPDATE: packages/sdk/src/host/auth.ts:165-181` - `watchedAs` is the name a connection watches a session by; `channelAwaiting` looks only at those sessions.
- `UPDATE: packages/sdk/src/host/handshake.ts:145-240` - `expire` names a session the connection watches; `aimedAt` refuses a session it does not watch.
- `UPDATE: packages/sdk/src/host/handshake.ts:633-661` - a token with no target goes to the waiting chats of the watched sessions.
- `UPDATE: docs/sdk/AUTHENTICATION.md:78-80` - the sessions a connection asks for are the ones it watches.
- `UPDATE: docs/sdk/AHP.md:96` - the same, in the `authenticate` row.
- `UPDATE: docs/sdk/AHP.md:160` - `auth/required` reaches a connection under the spelling it watches by.
- `CREATE: packages/sdk/test/authenticate-watching.test.ts` - two clients, each watching one of two sessions whose servers wait for one resource.

## Steps

1. Write the cases in `authenticate-watching.test.ts` for the rules in the plan's *Answers*.
2. Run the file on the host as it is, and see each case fail.
3. Add `watchedAs` to `auth.ts`, with the test `leaves` uses for a client in a session.
4. Ask each watcher to sign in under its own spelling.
5. Give a token with no target to the waiting chats of the watched sessions only.
6. Refuse a target whose session the connection does not watch, with `-32602`.
7. Name a watched session in the expiry, through `channelAwaiting` and the target.
8. Write the watched sessions into `AUTHENTICATION.md` and `AHP.md`.
9. Run the new file, the files that cover `authenticate`, and the type check.

## Validation

- `packages/sdk/test/authenticate-watching.test.ts`: every case fails before the change and passes after it.
- `packages/sdk/test/authenticate-target.test.ts`, `packages/sdk/test/nested-proxy.test.ts`, `packages/sdk/test/host-handshake.test.ts` and `packages/sdk/test/toolauth.test.ts` pass.
- `pnpm run typecheck` reports no errors.

## Resume

Done 2026-10-30.
Every step is built, and the test files and the type check pass.
