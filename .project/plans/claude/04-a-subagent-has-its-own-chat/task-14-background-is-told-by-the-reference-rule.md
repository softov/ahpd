---
title: Any task_started marks a worker background, and a foreground spawn ends on its result
status: todo
depends: [task-11-a-worker-ends-once-and-stays-ended.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L2461-L2475](../../../../packages/agent-claude/src/session.ts#L2461-L2475) - `task_started` and `task_notification`, reading `is_backgrounded`"
  - "[code://packages/agent-claude/src/session.ts#L1661-L1669](../../../../packages/agent-claude/src/session.ts#L1661-L1669) - the spawning call's result, which ends a worker unless it is background"
  - "[code://packages/agent-claude/src/session.ts#L1448-L1460](../../../../packages/agent-claude/src/session.ts#L1448-L1460) - where a `Task` or `Agent` call's input is recorded in `spawning`"
  - "[code://test/fixtures/claude-subagent.jsonl](../../../../test/fixtures/claude-subagent.jsonl) - the foreground capture: `run_in_background: false` on line 2, `task_started` on line 3, `task_notification` on line 12, the call's `tool_result` on line 13"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/claude/claudeSubagentSignals.ts - `mapSubagentSystemMessage`, the reference's rule
---

## Objective

Per [Any task_started marks a worker background, but a foreground spawn still ends on its tool_result](../../../decisions/background-is-any-task-started-but-foreground-ends-on-its-result.md), a worker is background once `task_started` names its call, and a worker whose call said `run_in_background: false` still ends on that call's `tool_result`.

## Files

- `UPDATE: packages/agent-claude/src/session.ts:1448-1460` - `Spawning` does not record `run_in_background`.
- `UPDATE: packages/agent-claude/src/session.ts:2461-2475` - `task_started` marks background only when `is_backgrounded` is `true`; `task_notification` ends only calls in `background`.
- `UPDATE: packages/agent-claude/src/session.ts:1661-1669` - the result ends a worker unless it is in `background`.
- `UPDATE: test/agent-claude-subagent.test.ts:152-174`.

## Steps

1. Record `run_in_background` from the call's input in `Spawning`, as `foreground: true` when it is `false` or absent.
2. `task_started` adds its `tool_use_id` to `background` whatever `is_backgrounded` says, as the reference does.
3. The spawning call's `tool_result` ends the worker when `Spawning.foreground` is true, background or not; it leaves it running when the call asked for the background.
4. A terminal `task_notification` ends any worker in `background`; `endWorker`'s `ended` set makes whichever signal comes second a no-op.
5. The "Async agent launched" text is no longer read, since `task_started` marks every worker.

## Validation

- `test/agent-claude-subagent.test.ts`, foreground: replay `claude-subagent.jsonl` with the pull queue task 11 builds; after line 12 (the `task_notification`) the worker has ended once as `complete`, and line 13 (the `tool_result`) ends nothing more. Today the notification is ignored for a call `is_backgrounded: false` names, so the worker is still open after line 12 and the case fails.
- The same file: the foreground fixture with line 12 removed still ends the worker once, on line 13, as `complete`.
- The same file, background: `claude-subagent-background.jsonl` still survives its "launched" result and ends only on its notification.
- `pnpm typecheck` green.

## Resume
