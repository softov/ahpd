---
title: Turns are fetched only for a session's channel
status: todo
depends: [task-03-a-channel-is-a-string-or-refused.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/sessionmethods.ts#L160-L172](../../../../packages/sdk/src/host/sessionmethods.ts#L160-L172) - `fetchTurns`"
  - "[code://packages/sdk/src/host/snapshots.ts#L243](../../../../packages/sdk/src/host/snapshots.ts#L243) - `snapshotOf`'s `sessionChannel` guard"
---

## Objective

`fetchTurns` on a terminal or file name refuses rather than sending a session's turns as `chat/turnsLoaded` on that channel, as host/30 task 08 says a session id is never read out of a file or terminal name.

## Files

- `UPDATE: packages/sdk/src/host/sessionmethods.ts:160-172` - the guard.
- `UPDATE: packages/sdk/test/users-gate-names.test.ts` - the case below.

## Steps

1. Failing case first: a terminal named `ahp-terminal:/<session-id>`; `fetchTurns` on it today sends that session's turns to the terminal's subscribers.
2. Guard `fetchTurns` the way `snapshotOf` does at `snapshots.ts:243`: a channel that is not a session's or a chat's is refused `-32602` before `sessionFor` is read.

## Validation

- The case fails on `main` and passes after; `fetchTurns` on a session and on its chats is unchanged.
- `pnpm exec vitest run packages/sdk/test/users-gate*.test.ts packages/sdk/test/host-names.test.ts`.

## Resume
