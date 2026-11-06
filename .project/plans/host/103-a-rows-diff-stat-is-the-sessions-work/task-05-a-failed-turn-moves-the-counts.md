---
title: A failed turn moves the counts
status: done
depends:
  - task-04-a-rows-changes-are-the-sessions-summary.md
layer: sdk
refs:
  - "[code://packages/sdk/src/host/spawn.ts#L999-L1004](../../../../packages/sdk/src/host/spawn.ts#L999-L1004) - the turn end, on complete and cancel only"
  - "[code://packages/sdk/src/host/spawn.ts#L861-L870](../../../../packages/sdk/src/host/spawn.ts#L861-L870) - `chat/error`"
---

## Objective

`chat/error` writes a checkpoint and reads the folder again, as a finished turn does.

## Files

- `UPDATE: packages/sdk/src/host/spawn.ts:999-1004` - add `chat/error` to the turn ends.
- `UPDATE: packages/sdk/test/host-catalogue.test.ts` - the failed turn case.

## Steps

1. Write the test first.
2. Add `chat/error` to the condition at line 999.
3. Set this task and the plan row to `implemented`.

## Validation

- A test: a turn that writes a file and then fails moves the row's counts.
- `pnpm -s typecheck` and the sdk vitest suite pass.

## Resume

- **Done so far:** Built 2026-10-16.
  The turn-end condition in `spawn.ts` now takes `chat/error` with the two endings the protocol names.
  A failed turn checkpoints its tree, has its counts read and has the folder's facts re-read, as a finished turn does.
  The comment above the condition says so.
  1 test is in `test/host-catalogue.test.ts`: `moves a row with the work a turn did before it failed`.
  It fails with `files: 2` instead of `files: 5` without the condition.
  The gates pass, and the sdk suite passes with 2999 tests.
- **Next action:** [task-06-the-docs-say-what-a-row-counts.md](task-06-the-docs-say-what-a-row-counts.md).
- **Open questions:** none.
- **Watch out for:** A failure is the agent's to report, so the test ends the turn with the fake CLI's `error_during_execution` result.
  A client may not dispatch `chat/error`.
  The task's refs point at lines that tasks 01 and 04 moved.
  The condition it means is the turn end that checkpoints, now at `spawn.ts:1016`.
  Restore `packages/sdk/test/fixtures/wire.jsonl` with `git checkout -- packages/sdk/test/fixtures/wire.jsonl`; the suite dirties it.
