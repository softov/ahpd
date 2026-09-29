---
title: The docs say what a stop in a worker chat does
status: done
depends: [task-02-claude-stops-one-worker.md]
layer: "docs"
refs:
  - "[code://docs/PLUGINS.md](../../../../docs/PLUGINS.md) - \"A backend's worker chats\" and the `Session` seam"
  - "[code://packages/agent-claude/README.md](../../../../packages/agent-claude/README.md) - the subagent chat paragraph and the options"
---

## Objective

`docs/PLUGINS.md` names `stopWorker` and what a worker chat's stop does without it, and the agent-claude README names `workerStop`.

## Files

- `UPDATE: docs/PLUGINS.md`, `packages/agent-claude/README.md`.

## Steps

1. Match each file's existing style; no em dash.

## Validation

- Every sentence re-read against the code; every relative link resolves.

## Resume

Written.

- `docs/PLUGINS.md`, in `A backend's worker chats`: what a client may still send on a worker chat, that a stop there calls `Session.stopWorker(toolCallId)` and leaves the lead turn running, that without it the lead chat's running turn is cancelled, and that the Claude backend's `workerStop: "session"` makes it cancel the lead turn.
- `packages/agent-claude/README.md`: `workerStop` in the options table, and one sentence in the subagent paragraph on what a stop in a subagent's chat does, the option, and the fallback before the harness has named the task.
- `docs/AGENT.md`: `stopWorker?(toolCallId)` in the `Session` table's turn row; not in the task's Files, but it is where the `Session` contract is listed.

No em dash; no relative link added.

Gates: `pnpm typecheck` clean; `pnpm boundary` clean; `pnpm test` 107 files, 1549 tests passed.
