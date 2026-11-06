---
title: Claude's own task calls write the plan
status: done
depends: [task-02-the-sessions-plan-takes-a-harness-list.md, task-04-claude-keeps-its-own-tools-on-a-setting.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session/stream.ts#L306-L322](../../../../packages/agent-claude/src/session/stream.ts#L306-L322) - a complete `tool_use` block, where the input of a call is known"
  - "[code://packages/agent-claude/src/input.ts#L307](../../../../packages/agent-claude/src/input.ts#L307) - `TodoWrite`, a whole list in `todos`"
  - "[code://packages/agent-claude/src/input.ts#L324-L336](../../../../packages/agent-claude/src/input.ts#L324-L336) - `TaskCreate` and `TaskUpdate`, one change each"
---

## Objective

When Claude keeps its own tools, each `TodoWrite`, `TaskCreate` and `TaskUpdate` call writes the session's plan through the seam of task 01.

## Files

- `CREATE: packages/agent-claude/src/session/tasks.ts` - the translation of the three tools into a list or one change.
- `UPDATE: packages/agent-claude/src/session/stream.ts:306-322` - hand each complete call of the three tools to the translation.
- `UPDATE: packages/agent-claude/test/agent-claude-tasks.test.ts` - each tool, through a fake stream.

## Steps

1. Read `TodoWrite` as a whole list, with each todo's `content` and `status`.
2. Read `TaskCreate` as one change that adds a task, with its `subject`.
3. Read `TaskUpdate` as one change to a task, by the harness's task id.
4. Hand the list or the change to the host with the call of task 01.
5. Hand a `TaskCreate` only after its result gives the harness's task id.
6. Make no call when the host task tools are in place.

## Validation

- `packages/agent-claude/test/agent-claude-tasks.test.ts`: a `TodoWrite` hands the whole list with each status.
- `packages/agent-claude/test/agent-claude-tasks.test.ts`: a `TaskCreate` then a `TaskUpdate` hand two changes with one harness id.
- `packages/agent-claude/test/agent-claude-tasks.test.ts`: an empty `TodoWrite` after every todo is `completed` hands an empty list.
- `pnpm vitest run packages/agent-claude/test` passes.

## Resume

- **Done so far:** every step. `session/tasks.ts` translates `TodoWrite` as a whole list and `TaskCreate` and `TaskUpdate` as one change each, and hands them to `ctx.options.planUpdate`. `TaskCreate` waits for its result, where `tool_use_result` carries `{ task: { id, subject } }`. `stream.ts` calls the translation on a complete `tool_use` block and on the result, and `query.ts` now passes the frame's `tool_use_result` through `results`. Nothing is handed when `hostHoldsTasks` says the host's tools are in place.
- **Files:** `packages/agent-claude/src/session/tasks.ts`, `packages/agent-claude/src/session/stream.ts`, `packages/agent-claude/src/session/query.ts`, `packages/agent-claude/src/options.ts`, `packages/agent-claude/src/claude.ts`, `packages/sdk/src/types/session.ts`, `packages/agent-claude/test/agent-claude-tasks.test.ts`.
- **Next action:** task 06.
- **Open questions:** none.
- **Watch out for:** the seam task 01 added stopped at `Start`. `SessionOptions` had no `planUpdate` and `claude.ts` did not carry it, so this task adds both. `hostHoldsTasks` moved to `options.ts` so the query and the translation read one rule. A `TaskUpdate` id is read as `taskId`, `id` or `task_id`. Claude Code repairs the last two before it runs the call, and the stream keeps the model's spelling. `TaskCreate` is handed only once, from its result: a call whose result carries no `task.id` writes nothing.
