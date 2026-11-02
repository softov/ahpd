---
title: The count is the sessions with a turn running
status: done
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/catalogue.ts#L484-L502](../../../../packages/sdk/src/host/catalogue.ts#L484-L502) - `activeCount` and `activeSessionsMoved`"
  - "[code://packages/sdk/src/host/catalogue.ts#L1458-L1482](../../../../packages/sdk/src/host/catalogue.ts#L1458-L1482) - `chatMoved`"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1440-L1499](../../../../packages/sdk/src/host/sessionmethods.ts#L1440-L1499) - a chat closed"
---

## Objective

`activeCount` is the number of running sessions with a chat whose held state has an active turn.
`activeSessionsMoved` says it when the root's state holds another number, after every chat action and every chat or session that goes.

## Files

- `UPDATE: packages/sdk/src/host/catalogue.ts:484-502` - `activeCount` from the chats' held states, and `activeSessionsMoved` against the root's state.
- `UPDATE: packages/sdk/src/host/catalogue.ts:1458-1482` - `chatMoved` reads the count again.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:1495-1499` - a chat closed reads the count again.
- `UPDATE: packages/sdk/test/host-catalogue.test.ts:46-69` - the count follows a turn, and a session with nothing running counts nothing.
- `UPDATE: packages/sdk/test/presence.test.ts:517-525` - the count said is a turn's start and end.
- `UPDATE: packages/sdk/test/session-sleep.test.ts` - a session kept awake is read by its agent, and a sleeping session counts nothing.
- `UPDATE: packages/sdk/test/session-wakeup-tool.test.ts:255-276` - a wake is read by the turn it runs.
- `UPDATE: packages/server/test/plugin-live.test.ts:378-409` - an unload is read by the sessions it removes.
- `UPDATE: docs/sdk/AHP.md:188` - the `root/activeSessionsChanged` row.
- `UPDATE: docs/sdk/HOST.md:25` - the `activeSessions` row.
- `UPDATE: docs/sdk/SESSIONS.md:36` - a sleep and a wake.

## Steps

1. Write `activeCount` from each running session's chats and workers.
2. Make `activeSessionsMoved` compare its number with the root's held state, or with the last it said.
3. Call `activeSessionsMoved` from `chatMoved` and from a chat's close.
4. Change the tests that read the number as the sessions held open.
5. Add a case of the count through a turn.
6. Say what the number counts in the three docs.

## Validation

- `packages/sdk/test/host-catalogue.test.ts` and `packages/sdk/test/presence.test.ts`: the count cases fail on `6e6d1ca8` and pass after.
- `session-sleep.test.ts`, `session-wakeup-tool.test.ts` and `plugin-live.test.ts` pass.
- `pnpm run typecheck` is clean.

## Resume

Built 2026-11-02 in `9a23b4a6`.

- `activeCount` reads each running session's held chats and its workers' chats, and counts the sessions with an active turn.
- `activeSessionsMoved` compares with the root's held state, so the first call at a session's creation says nothing.
- The presence case reads the count after the turn's end and again after the disposal.
- The base's count also says 1, then 0, across a creation and a disposal.
- So the read at the turn's end is the one that tells the two counts apart.
- In `session-sleep.test.ts`, four cases read a session kept awake by `awake()`, the agents running.
- One case there drops its count, and keeps the session list it already reads.
- The sleeping session's case reads a count of 0, since a session asleep runs no turn.
- `session-wakeup-tool.test.ts` waits on a wake by `awake()`, and `plugin-live.test.ts` reads an unload by the session's `root/sessionRemoved`.
