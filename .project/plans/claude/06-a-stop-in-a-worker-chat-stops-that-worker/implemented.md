---
title: "A stop in a worker chat stops that worker, unless configured to stop the session - implemented"
date: 2026-09-28
refs:
  - git://373253e
  - "[code://packages/sdk/src/types/session.ts](../../../../packages/sdk/src/types/session.ts) - `Session.stopWorker`"
  - "[code://packages/agent-claude/src/session.ts](../../../../packages/agent-claude/src/session.ts) - `stopWorker`, `workerStop`"
---

Stopping inside a subagent's chat stops that subagent, and the lead turn goes on and sees the subagent's call end as stopped.
The Claude backend's `workerStop: "session"` cancels the whole turn instead.

## What was built

- `Session.stopWorker?(toolCallId)`; the host calls it for a stop in a worker chat, and cancels the lead turn when a backend has none.
- [`code://packages/agent-claude/src/session.ts`](../../../../packages/agent-claude/src/session.ts) - `stopWorker` calls `stopTask` with the worker's task id; with `workerStop: "session"`, or before the task has an id, it cancels the lead turn.
- `docs/PLUGINS.md`, `docs/AGENT.md` and the agent-claude README.

## Verified

- `subagent-chat.test.ts` and `agent-claude-subagent.test.ts` (foreground, background, `workerStop: "session"`, no task id yet); the new cases failed first.
- `pnpm typecheck`, `pnpm boundary` clean; full `pnpm test` 1549 tests passed.

## Departures from the plan

- A failed `stopTask` is ignored rather than falling back to cancelling the lead turn.

## Left for later

- By hand in ahpapp: Stop inside a subagent, with and without `workerStop: "session"`.
- The stopped notification in the tests is written in the captured shape; no capture of a real `stopTask` exists.
