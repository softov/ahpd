---
title: Claude stops one worker with stopTask, or the session under the option
status: implemented
depends: [task-01-the-host-asks-to-stop-one-worker.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L2508-L2530](../../../../packages/agent-claude/src/session.ts#L2508-L2530) - `task_started` and `task_notification` handling"
  - "[code://packages/agent-claude/src/session.ts#L3239-L3266](../../../../packages/agent-claude/src/session.ts#L3239-L3266) - `cancel`, which ends the cancelled turn's workers"
  - "[code://packages/agent-claude/src/claude.ts#L84](../../../../packages/agent-claude/src/claude.ts#L84) - `ClaudeOptions`"
  - "[code://packages/agent-claude/test/agent-claude-subagent.test.ts](../../../../packages/agent-claude/test/agent-claude-subagent.test.ts) - the SDK mock, a pull queue per query"
---

## Objective

agent-claude's `stopWorker(call)` calls `stopTask` with the worker's task id, and the worker ends as `cancelled` on the `stopped` notification; with `workerStop: 'session'`, or before the worker's `task_started`, it cancels the lead turn.

## Files

- `UPDATE: packages/agent-claude/src/session.ts:2508-2530` - keep `task_id` by `tool_use_id` from `task_started`, and forget it when the worker ends.
- `UPDATE: packages/agent-claude/src/session.ts` - `stopWorker` beside `cancel`.
- `UPDATE: packages/agent-claude/src/claude.ts` and the plugin option schema - `workerStop: 'worker' | 'session'`, default `worker`.
- `UPDATE: packages/agent-claude/test/agent-claude-subagent.test.ts` - the cases below; the mock records `stopTask`.

## Steps

1. The lead turn's state is untouched by a worker stop; the spawning call completes with whatever result the CLI gives for a stopped task.

## Validation

- Over `claude-subagent-background.jsonl` (and a foreground capture), `stopWorker` calls `stopTask` with the captured task id, the lead turn stays open, and a `stopped` notification ends the worker once as `cancelled`; it fails first.
- With `workerStop: 'session'`, `stopWorker` cancels the lead turn.
- Before `task_started`, `stopWorker` cancels the lead turn.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

Built, in `packages/agent-claude/src/session.ts`.
`task_started` records its `task_id` in `tasks`, keyed by the call's `tool_use_id`, unless that worker has already ended, and `endWorker` forgets it.
`stopWorker(toolCallId)` calls `handle.stopTask(taskId)` and leaves the lead turn alone; the worker ends as `cancelled` when the harness's `stopped` notification arrives, through the existing `task_notification` path, which ends a worker once.
With `workerStop: 'session'`, or when no task id has been named for the call yet, it calls the session's own `cancel('')`, which stops the running lead turn and ends its workers.
To call `cancel` from `stopWorker`, the returned object is now held as `const self: Session` and returned at the end; nothing else about it changed.
`workerStop?: 'worker' | 'session'` is on `ClaudeSessionOptions` and `ClaudeOptions`, passed through by `claude()`, read by the plugin's `optionsOf` when it is one of the two values, and declared in the package's `ahpd.options`.

Tests, in `packages/agent-claude/test/agent-claude-subagent.test.ts`, with the SDK mock now recording `stopTask` and `interrupt`:

- `stops one foreground worker with its task id, and leaves the lead turn running`: over `claude-subagent.jsonl` through its sixth frame, `stopTask('a39214c163af9a96a')`, no interrupt, no `chat/turnCancelled`, the worker open until two `stopped` notifications end it once as `cancelled`.
- `stops one background worker with its task id`: over `claude-subagent-background.jsonl` through its seventh frame, `stopTask('af279e8136cb23ae9')`, and the `stopped` notification ends it as `cancelled`.
- `cancels the lead turn instead when configured to stop the session`: `workerStop: 'session'`, no `stopTask`, one interrupt, the worker ended as `cancelled`.
- `cancels the lead turn when the worker has no task id yet`: the first two frames only, before `task_started`, one interrupt and no `stopTask`.

Failed first: all four, the first two with `stopTask` never called and the last two with no interrupt, because the backend had no `stopWorker`.

Not tested: `claude()` and the plugin passing `workerStop` through; each is a single conditional spread or assignment, and no existing test drives the plugin's options.
The stopped notification in the tests is written by hand in the shape of the captured ones (`status: 'stopped'`), because no capture of a real `stopTask` exists; `stopTask` failing is caught and ignored, and the question of whether it should fall back to cancelling the lead turn is open for review.

Gates: `pnpm typecheck` clean; `pnpm boundary` clean; `pnpm test` 107 files, 1549 tests passed.
