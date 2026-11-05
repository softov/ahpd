---
title: Claude's chat state holds every turn
status: done
depends:
  - task-02-a-snapshot-follows-the-subscribes-view.md
layer: agent-claude
refs:
  - "[code://packages/agent-claude/src/session.ts#L245-L266](../../../../packages/agent-claude/src/session.ts#L245-L266) - `chatState()`, which cuts with `...tail(ctx.turns)`"
  - "[code://packages/agent-acp/src/session.ts#L247](../../../../packages/agent-acp/src/session.ts#L247) - the sibling that gives every turn"
  - "[code://packages/sdk/src/host/tooling.ts#L1637-L1652](../../../../packages/sdk/src/host/tooling.ts#L1637-L1652) - `get_session_context`, which reads `chatState()`"
  - "[code://packages/sdk/src/tools/session.ts#L630](../../../../packages/sdk/src/tools/session.ts#L630) - `transcriptLimit`, the cut that tool keeps"
  - "[code://packages/sdk/test/host-catalogue.test.ts#L278-L381](../../../../packages/sdk/test/host-catalogue.test.ts#L278-L381) - the live case from task 01"
---

## Objective

Claude's `chatState()` gives every turn it holds, as the ACP, pi, cofold and bot backends do.
A subscribe with no view to a live Claude chat then gets every turn, and the host applies a view from task 02.

## Files

- `UPDATE: packages/agent-claude/src/session.ts:245-266` - `chatState()` gives `turns: ctx.turns`, and the comment above it says the host cuts for a view.
- `UPDATE: packages/sdk/test/host-catalogue.test.ts:277-380` - the live case from task 01 becomes `it`, and one case subscribes to a live chat with a view.

## Steps

1. Replace `...tail(ctx.turns)` in `chatState()` with `turns: ctx.turns`.
2. Remove the `tail` import from `session.ts` if nothing else in the file uses it.
3. Change the live case from task 01 from `it.fails` to `it`.
4. Add a case that subscribes to the live chat with a view, and expects a window and a cursor.
5. Run the `get_session_context` tests, and check that `transcriptLimit` still cuts the transcript.
6. Run the agent-claude and sdk tests, and set this task and its plan row to `implemented`.

## Validation

- `pnpm vitest run packages/sdk/test/host-catalogue.test.ts packages/sdk/test/sessiontools.test.ts` passes.
- `pnpm vitest run packages/agent-claude/test` passes.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass.

## Resume

Done 2026-10-28. Claude's `chatState()` gives `turns: ctx.turns`, and the comment above it says the host cuts the window a subscribe asks for. `tail` left the import in `session.ts`, because nothing else in the file used it. The live case from task 01 is now `it` and reads 121 turns with no cursor. A second live case subscribes with `view: { turns: 20 }` and reads the newest 20, ending at "say ok", with cursor `101`. The host cases, the `get_session_context` cases and all of agent-claude pass, 499 tests in 46 files. `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass. The full suite passes, 448 files and 7445 tests.
