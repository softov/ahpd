---
title: A background row outlives its turn
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session/workers.ts#L49-L54](../../../../packages/agent-claude/src/session/workers.ts#L49-L54) - `TaskInfo` gains `chat` and `command`"
  - "[code://packages/agent-claude/src/session/workers.ts#L529-L563](../../../../packages/agent-claude/src/session/workers.ts#L529-L563) - `reconcileWork` pins and reads them"
  - "[code://packages/agent-claude/src/session/workers.ts#L455-L479](../../../../packages/agent-claude/src/session/workers.ts#L455-L479) - `shellWork` takes the command from the record"
  - "[code://packages/agent-claude/test/agent-claude-background-work.test.ts#L156-L177](../../../../packages/agent-claude/test/agent-claude-background-work.test.ts#L156-L177) - `shellFrames` and `level`, the helpers the new cases use"
---

## Objective

A background task keeps its row after the turn that started it ends.
Only the task that stopped or ended leaves the chat's rows, and a row keeps the command its call ran.

## Files

- `UPDATE: packages/agent-claude/src/session/workers.ts:49-54` - add `chat?: string` and `command?: string` to `TaskInfo`, each with a one-line comment.
- `UPDATE: packages/agent-claude/src/session/workers.ts:455-479` - `shellWork` takes the command from `info.command` when the part is gone.
- `UPDATE: packages/agent-claude/src/session/workers.ts:529-563` - `reconcileWork` pins the chat and command on first resolve, and uses the pinned chat when `scopeOfCall` finds nothing.
- `UPDATE: packages/agent-claude/test/agent-claude-background-work.test.ts` - two cases that end the turn before a task changes.

## Steps

1. In `reconcileWork`, when `scopeOfCall` and `workChatOf` resolve a task, write `chat` on its `TaskInfo`.
2. In the same place, write the shell's command from the call's part on its `TaskInfo`, when the part has one.
3. When `scopeOfCall` finds no scope, build the entry from the pinned `chat`.
4. Skip the task only when it has no pinned `chat`.
5. Make `shellWork` read `info.command` when the part is gone, and the label only when neither exists.
6. Keep `dropTask` as it is, so the record and its pinned values go with the task.
7. Add a case: two shells, a `result` frame, then a `task_notification` with status `stopped` for one.
8. Assert that `tasks.remove` names only the stopped shell's row, and that the other row is not removed.
9. Add a case: two shells, a `result` frame, then a level that lists only one shell.
10. Assert that `tasks.remove` names only the missing shell's row.
11. Assert that no later set changes the other row's command.

## Validation

- `packages/agent-claude/test/agent-claude-background-work.test.ts` holds the two new cases, and every case passes.
- `pnpm vitest run packages/agent-claude/test packages/sdk/test/conformance.test.ts` passes from the repository root.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.

## Resume

