---
title: A subagent's turn ends, foreground or background
status: implemented
depends: [task-03-subagent-frames-go-to-their-chat.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L2156-L2185](../../../../packages/agent-claude/src/session.ts#L2156-L2185) - `task_progress`, beside which `task_started` and `task_notification` go"
---

## Objective

A subagent's chat turn completes when its work does: on the call's `tool_result` for a foreground one, on a terminal `task_notification` for a background one.

## Files

- `UPDATE: packages/agent-claude/src/session.ts`.
- `UPDATE: test/agent-claude-subagent.test.ts`.

## Steps

1. Mark a call background when `task_started` names it.
2. On the `tool_result` for a call that is not background, end its subagent turn as complete, or as failed when the result is an error.
3. On `task_notification` with `completed`, `failed` or `stopped`, end the background one's turn.
4. End each subagent turn once, whichever arrives.
5. When the main turn is cancelled, cancel its running subagent turns.

## Validation

- A foreground replay ends the subagent turn on the `tool_result`; a background one ends only on the notification.
- A cancelled main turn leaves no subagent turn running.

## Resume

Built. `endWorker(callId, state, why)` calls the host's `end` once per worker, declines anything the worker was still asking, and forgets its scope.

- A call is background when `system:task_started` says `is_backgrounded: true`, which is the flag the real capture forced: this SDK sends `task_started` for a foreground worker too. A harness that omits the flag is caught by the spawning result itself, which says "Async agent launched" for a background one.
- A foreground worker ends on the `tool_result` of its spawning call, complete or failed; a background one ends only on a terminal `task_notification` (`completed`, `failed`, `stopped`). A foreground worker's `task_notification` is ignored, and whichever signal arrives second is a no-op.
- `cancel` ends every running worker's turn as `cancelled`.
- `test/agent-claude-subagent.test.ts` covers both fixtures: the foreground one ends once on the result, and the background one survives its immediate "launched" result, keeps routing frames after the lead turn, and ends on the notification.

