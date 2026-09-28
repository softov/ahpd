---
title: A stop in a worker chat stops that worker, unless configured to stop the session
domain: claude
status: active
priority: medium
created: 2026-09-28
revalidated: 2026-09-28
requires:
  - plans/claude/04-a-subagent-has-its-own-chat/plan.md
changes: []
creates: []
decisions:
  - decisions/a-stop-in-a-worker-chat-stops-that-worker.md
refs:
  - "[code://packages/sdk/src/host.ts#L8835-L8847](../../../../packages/sdk/src/host.ts#L8835-L8847) - a worker chat's `chat/turnCancelled` cancels the lead turn"
  - "[code://packages/sdk/src/host.ts#L1253](../../../../packages/sdk/src/host.ts#L1253) - `WORKER_ACTIONS`"
  - "[code://packages/sdk/src/types/session.ts#L359](../../../../packages/sdk/src/types/session.ts#L359) - `cancel(turnId)`, the only stop a backend offers"
  - "[code://packages/agent-claude/src/session.ts#L2514](../../../../packages/agent-claude/src/session.ts#L2514) - `task_started`, which carries the worker's `task_id` and `tool_use_id`"
  - "[code://packages/agent-claude/src/session.ts#L2524](../../../../packages/agent-claude/src/session.ts#L2524) - a `stopped` notification ends the worker as `cancelled`"
  - "[code://packages/agent-claude/src/claude.ts#L84](../../../../packages/agent-claude/src/claude.ts#L84) - `claude(options)`, where the backend's options are read"
  - npm://@anthropic-ai/claude-agent-sdk@0.3.278 - `Query.stopTask(taskId)`: stops one task and emits its `task_notification` as `stopped`
---

## Goal

Stopping inside a subagent's chat stops that subagent, and the turn that started it goes on and sees the subagent's call end as stopped.
A backend option makes that stop cancel the whole turn instead, as it does today.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `grep -n stopTask sdk.d.ts` - `stopTask(taskId)` on `Query`, and `SDKControlStopTaskRequest { subtype: 'stop_task', task_id }`.
- `grep -n task_id packages/agent-claude/src/session.ts` - the backend keeps no task id today.

### Runtime path

```
worker chat Stop -> chat/turnCancelled on ahp-chat://subagent/<session>/<call>
  -> host: [new] session.stopWorker?(call) when the backend has it, else session.cancel(lead turn)
  -> agent-claude: [new] query.stopTask(taskIdOf(call)), or cancel(lead turn) under the option
  -> task_notification stopped -> endWorker(call, 'cancelled')
```

### Gaps

- The host has no way to ask a backend to stop one worker.
- agent-claude does not keep a worker's task id.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [A stop in a worker chat stops that worker, and an option makes it stop the session](../../../decisions/a-stop-in-a-worker-chat-stops-that-worker.md) | 01, 02 |

| What | Source | Task |
| --- | --- | --- |
| The seam is an optional `Session.stopWorker(toolCallId)`; a backend without it keeps the lead-turn stop. | (defaulted: optional, so other backends are unchanged) | 01 |
| The option is agent-claude's `workerStop`, `worker` by default or `session`. | (defaulted: a name for the decision's option) | 02 |
| A worker whose `task_started` has not arrived yet is stopped by cancelling the lead turn. | (defaulted: there is no task id to stop yet) | 02 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The host asks a backend to stop one worker](task-01-the-host-asks-to-stop-one-worker.md) | implemented | - |
| [02 - Claude stops one worker with stopTask, or the session under the option](task-02-claude-stops-one-worker.md) | implemented | 01 |
| [03 - Docs](task-03-docs.md) | implemented | 02 |

## Risks and tradeoffs

- A Stop in the lead chat still ends background workers, since the SDK's interrupt kills them when the host does not declare `perTaskStopAffordance`; not changed here.

## Resume state

- **Done so far:** tasks 01 to 03 implemented, awaiting review.
- **Next action:** review tasks 01 to 03; then the by-hand check in ahpapp that Stop inside a subagent stops it and the lead turn goes on, and that `workerStop: "session"` cancels the lead turn.
- **Open questions:** whether a failed `stopTask` should fall back to cancelling the lead turn (it is ignored now); see task 02's Resume.
- **Watch out for:** the worker's call id is read from the worker chat URI with `toolCallOfSubagentChat`; a nested worker's chat stops only that worker.

## Final verification checklist

- [ ] In ahpapp, Stop inside a subagent stops it, the lead turn continues, and the call shows the subagent stopped.
- [ ] With `workerStop: "session"`, the same Stop cancels the lead turn.
- [ ] `pnpm typecheck`, `pnpm boundary`, `pnpm test` green; `plans/index.md` updated.
