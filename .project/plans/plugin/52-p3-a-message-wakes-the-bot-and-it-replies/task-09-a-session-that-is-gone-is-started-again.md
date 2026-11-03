---
title: A session that is gone is started again
status: done
depends: [task-03-a-message-wakes-a-back-session.md]
layer: "packages/sdk, packages/bot"
refs:
  - "[code://packages/sdk/src/plugins/plugins.ts#L955-L958](../../../../packages/sdk/src/plugins/plugins.ts#L955-L958) - `sessionOwner` reads the owner row only"
  - "[code://packages/sdk/src/sessions/sessions.ts#L103](../../../../packages/sdk/src/sessions/sessions.ts#L103) - the owner row outlives a session with no turns"
  - "[code://packages/sdk/src/host/snapshots.ts#L538-L541](../../../../packages/sdk/src/host/snapshots.ts#L538-L541) - a subscribe to that session is `No agent for session`"
  - "[code://packages/bot/src/wake.ts](../../../../packages/bot/src/wake.ts) - `sessionNamed` trusts `sessions.owner`"
  - "[code://packages/bot/src/provider.ts](../../../../packages/bot/src/provider.ts) - `chatOf` trusts `sessions.owner`"
---

## Objective

A session with no turns is not kept on disk, so a restart removes it, but its owner row stays.
`sessionOwner` then answers an owner for a session the host cannot open.
The wake then sends to that session and fails with `No agent for session`.
A read of the bot then answers a main chat that a client cannot open.
After this task, `sessionOwner` answers nothing for a session that is neither running nor on disk.
The wake and the chat read then start a new session and write the row again.

## Files

- `UPDATE: packages/sdk/src/plugins/plugins.ts` - `sessionOwner` answers nothing for a session the host cannot open.
- `UPDATE: packages/sdk/src/types/plugin.ts` - say so on `sessionOwner`.
- `CREATE: packages/sdk/test/plugin-session-owner.test.ts` - the tests of the answer.
- `UPDATE: packages/bot/test/bot-wake.test.ts` - a row on a gone session starts a new one.

## Steps

1. Find how the host knows that a session is running or is in its catalogue.
2. Make `sessionOwner` answer `undefined` when the session is neither.
3. Keep the answer for a running session and for a session on disk.
4. Check that `sessionNamed` in the wake and `chatOf` in the provider start a new session on `undefined`.
5. Find each other caller of `sessionOwner`, and check that `undefined` is correct for it.
6. Stop and report when a caller needs the old answer.

## Validation

- `plugin-session-owner.test.ts`: test that a session with an owner row and no catalogue entry answers `undefined`.
- `plugin-session-owner.test.ts`: test that a running session and a session on disk answer their owner.
- `bot-wake.test.ts`: test that a row on a gone session starts a new back session and writes the row.
- The gates pass: build, typecheck, boundary, schema and vitest.
