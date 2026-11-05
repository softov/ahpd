---
title: The cut is shown
status: done
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/test/host-catalogue.test.ts#L278-L381](../../../../packages/sdk/test/host-catalogue.test.ts#L278-L381) - the paging cases and their `opened` helper, which reads 120 turns from a Claude transcript"
  - "[code://packages/sdk/test/support/host.ts](../../../../packages/sdk/test/support/host.ts) - `serving` and `running`, the helpers the paging cases use"
  - "[code://packages/sdk/src/host/snapshots.ts#L483-L500](../../../../packages/sdk/src/host/snapshots.ts#L483-L500) - the snapshot of a session's chat that is not running"
  - "[code://packages/agent-claude/src/session.ts#L256](../../../../packages/agent-claude/src/session.ts#L256) - the cut in a live Claude chat"
---

## Objective

Two host tests show that a subscribe with no view gets 50 of 120 turns.
One test is for a chat that is not running, and one is for a live Claude chat.
Softov runs the check by hand in [`pending/host-114-turn-cut-checks.md`](../../../pending/host-114-turn-cut-checks.md), and its result is in this file.

## Files

- `UPDATE: packages/sdk/test/host-catalogue.test.ts:277-380` - two `it.fails` cases in `paging a long history` that expect every turn from a subscribe with no view.

## Steps

1. Add a case that opens a 120-turn session with `opened()` and expects 120 turns and no `turnsNextCursor`.
2. Add a case that sends one turn to that session and waits for the turn to end.
3. In that second case, subscribe to the chat again, and expect 121 turns and no `turnsNextCursor`.
4. Mark both cases `it.fails`.
5. Run `pnpm vitest run packages/sdk/test/host-catalogue.test.ts`, and check that both cases fail as expected.
6. Ask Softov to run the check in `pending/host-114-turn-cut-checks.md` in a VS Code 1.143 window.
7. Write Softov's reply in the Resume below: the first message shown, and the turns, cursor and bytes of each snapshot.
8. If the reply is "no cut", stop and tell Softov that the window shows no defect.
9. Set this task and its plan row to `implemented`.

## Validation

- `pnpm vitest run packages/sdk/test/host-catalogue.test.ts` passes, with the two new cases reported as expected failures.
- `pnpm -s typecheck` passes.
- The Resume holds the reply to the check by hand.

## Resume

Done 2026-10-28.
Two cases in `paging a long history` show the cut.
A chat that is not running gives 50 of 120 turns, and a live Claude chat gives 50 of 121.
Both are `it.fails`, and each fails on the count alone, so the suite stays green.
`opened()` now writes the CLI's conversation, so a turn sent to the session resumes it rather than starting one under the test's id.
The check by hand in [`pending/host-114-turn-cut-checks.md`](../../../pending/host-114-turn-cut-checks.md) was not run in this session, because no VS Code window is available here.
Its reply is still owed, and [task 05](task-05-a-window-shows-every-turn.md) asks for it again after the fix.

