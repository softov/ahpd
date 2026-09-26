---
title: A cancelled turn ends its own workers, and an ended worker stays ended
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L872-L884](../../../../packages/agent-claude/src/session.ts#L872-L884) - `Spawning`, `spawning`, `background`, `byAgent` and `ended`"
  - "[code://packages/agent-claude/src/session.ts#L895-L925](../../../../packages/agent-claude/src/session.ts#L895-L925) - `scopeFor`, which opens a worker for any parent it holds no scope for"
  - "[code://packages/agent-claude/src/session.ts#L951-L967](../../../../packages/agent-claude/src/session.ts#L951-L967) - `endWorker`, which deletes the scope"
  - "[code://packages/agent-claude/src/session.ts#L3196-L3206](../../../../packages/agent-claude/src/session.ts#L3196-L3206) - `cancel`, which ends every worker"
  - "[code://test/agent-claude-subagent.test.ts#L19-L47](../../../../test/agent-claude-subagent.test.ts#L19-L47) - the SDK mock, which yields every frame at once"
---

## Objective

Cancelling a turn ends only the workers spawned in it, per [A cancelled turn ends only the workers it spawned](../../../decisions/a-cancelled-turn-ends-only-its-own-workers.md); a frame that arrives for a worker that has ended is dropped rather than reopening it; and a worker's records go when it ends.

## Files

- `UPDATE: packages/agent-claude/src/session.ts:872-884` - `Spawning` has no turn; nothing is ever deleted from `spawning`.
- `UPDATE: packages/agent-claude/src/session.ts:895-925` - `scopeFor` calls `options.subagent` again for a parent `endWorker` removed.
- `UPDATE: packages/agent-claude/src/session.ts:951-967` - `endWorker`.
- `UPDATE: packages/agent-claude/src/session.ts:3196-3206` - `cancel`.
- `UPDATE: packages/agent-claude/src/session.ts:3402-3412` - `close`.
- `UPDATE: test/agent-claude-subagent.test.ts`.

## Steps

1. `Spawning` records the lead turn id the call was made in: the lead turn for a call in the main scope, and the spawning worker's own record's turn for a nested call.
2. `cancel` ends a worker only when its `Spawning.turn` is the turn being cancelled; a background worker from an earlier turn keeps its scope and ends on its `task_notification`.
3. `scopeFor` returns a sink for a parent in `ended`: frames for it are dropped, `options.subagent` is not called, and no scope is created.
4. `endWorker` deletes the call from `spawning`; a spawning call whose result arrives with no worker opened and not background is deleted from `spawning` there.
5. `ended` keeps one id per ended worker, because late frames need it, and is cleared in `close`.

## Validation

- The mock in `test/agent-claude-subagent.test.ts` becomes a pull queue a test pushes frames into, because the current one yields the whole fixture at once and a cancel cannot fall between two frames.
- Foreground cancel: push `claude-subagent.jsonl` lines 1 to 6, `cancel`, expect the worker ended once as `cancelled`; push line 7 (the inner `tool_result`), expect the seam was asked for the worker once. Today it is asked twice and the case fails.
- Background from an earlier turn: push `claude-subagent-background.jsonl` lines 1 to 6 (through the lead `result`), begin a second turn, `cancel`, expect the worker not ended; push lines 7 to 14, expect it ended once as `complete`. Today it ends as `cancelled` and the case fails.
- `pnpm typecheck` green.

## Resume
