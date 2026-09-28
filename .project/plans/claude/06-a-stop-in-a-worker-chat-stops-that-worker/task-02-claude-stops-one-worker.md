---
title: Claude stops one worker with stopTask, or the session under the option
status: todo
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
