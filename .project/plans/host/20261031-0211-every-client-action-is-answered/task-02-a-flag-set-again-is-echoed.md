---
title: A flag set again is echoed
status: done
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/host/actions.ts#L739-L750](../../../../packages/sdk/src/host/actions.ts#L739-L750) - the session flag caller"
  - "[code://packages/sdk/src/host/chatactions.ts#L219-L246](../../../../packages/sdk/src/host/chatactions.ts#L219-L246) - the chat flag caller"
  - "[code://packages/sdk/src/host/actions.ts#L708-L724](../../../../packages/sdk/src/host/actions.ts#L708-L724) - the echo to copy"
  - "[code://packages/sdk/test/presence.test.ts#L136](../../../../packages/sdk/test/presence.test.ts#L136) - the test to copy"
  - "[code://packages/sdk/test/host-snapshots.test.ts#L692-L709](../../../../packages/sdk/test/host-snapshots.test.ts#L692-L709) - the test this task changes"
  - "[code://docs/sdk/AHP.md#L727-L755](../../../../docs/sdk/AHP.md#L727-L755) - the section this task adds to"
---

## Objective

A `session/isReadChanged`, `session/isArchivedChanged`, `chat/isReadChanged` or `chat/isArchivedChanged` that does not move its flag is echoed to its sender only.
No other client hears it, and `serverSeq` does not move.

## Files

- `UPDATE: packages/sdk/src/host/actions.ts:739-750` - echo to the sender when `sessionFlag` returns `false`.
- `UPDATE: packages/sdk/src/host/chatactions.ts:235-241` - echo to the sender when `sessionFlag` or `chatFlag` returns `false`.
- `UPDATE: packages/sdk/test/host-snapshots.test.ts:692-709` - the second read gets an echo to the sender, and nothing else.
- `UPDATE: packages/sdk/test/presence.test.ts` - add the test of a session flag set again, with a second client that hears nothing.
- `UPDATE: docs/sdk/AHP.md:727-755` - say that a flag set again is answered as an unchanged set is.

## Steps

1. In `actions.ts`, keep the result of `sessionFlag`, and call `echoTo(connection.peer, channel, action, origin)` when it is `false`.
2. In `chatactions.ts`, echo to the sender when `sessionFlag` returns `false` for a default chat.
3. In `chatactions.ts`, echo to the sender where `chatFlag` returns `false`, before the `return`.
4. Keep `sessionFollows` and the read bit of an archived chat as they are when the flag moves.
5. Rename the test at `host-snapshots.test.ts:692`, and expect one echo with the sender's `origin` and no catalogue change.
6. Add a two-client test that sets a session's read flag twice, and expect one echo to the sender.
7. In `AHP.md`, remove the clause "`session/isReadChanged` always did this" from the paragraph at line 729.
8. Add one paragraph after the cancel paragraph that names the four flag actions.

## Validation

- `packages/sdk/test/host-snapshots.test.ts`: the changed test fails before the change and passes after it.
- `packages/sdk/test/presence.test.ts`: the new test passes, and the test at line 136 still passes.
- `pnpm typecheck` is clean, and `pnpm --filter @ahpd/sdk test` passes.
- Restore `packages/sdk/test/fixtures/wire.jsonl` after the test run.

## Resume

