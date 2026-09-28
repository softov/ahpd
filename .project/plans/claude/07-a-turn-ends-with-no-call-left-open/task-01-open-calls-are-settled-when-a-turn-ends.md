---
title: A turn's open tool calls are settled when it ends
status: implemented
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L2578](../../../../packages/agent-claude/src/session.ts#L2578) - the complete or error path"
  - "[code://packages/agent-claude/src/session.ts#L3268-L3274](../../../../packages/agent-claude/src/session.ts#L3268-L3274) - the cancel path"
  - "[code://packages/agent-claude/src/session.ts#L982](../../../../packages/agent-claude/src/session.ts#L982) - `endWorker`, a worker turn's end"
---

## Objective

On every turn end (complete, error, cancel, and a worker's end), a tool part that is still `streaming`, `running` or `pending-confirmation` is set to `cancelled` with reason `skipped` in the turn the backend keeps, and any pending ask for it is declined.

## Files

- `UPDATE: packages/agent-claude/src/session.ts` - one helper that settles a turn's open tool parts, called at 2578, at the cancel path, and in `endWorker`.
- `UPDATE: packages/agent-claude/test/` - the cases below.

## Steps

1. No new action is emitted for the settled parts: the live client's reducer already cancels them on the turn's end action; only the kept snapshot changes.
2. A pending ask on a settled call is removed from the input the session waits on, and its `canUseTool` promise is answered with a denial.

## Validation

- A turn with a `canUseTool` ask whose `toolUseID` and `agentID` match no scope, completed by `result`: the snapshot's call is `cancelled`, reason `skipped`, and `inputNeeded` is empty; it fails first with `pending-confirmation`.
- The same for a cancelled turn, and for a worker whose turn ends with a call running.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

Built, in `packages/agent-claude/src/session.ts`.
`settleOpen(turn)` rewrites every tool part of the turn whose status is not `completed` or `cancelled` into a cancelled call as the protocol reducer's `endTurn` does: `status: 'cancelled'`, `reason: 'skipped'`, and only `toolCallId`, `toolName`, `displayName`, `intention`, `contributor`, `_meta`, `invocationMessage` (`''` for a streaming call without one) and `toolInput` (dropped for a streaming call).
A `toolConfirmation` still pending for one of those calls is removed from the input the session waits on and its `canUseTool` promise is answered with a denial.
No action is emitted.
It is called on the `result` path before the turn is pushed (complete and error), on the path where the CLI dies mid-turn, on the cancel path, and in `endWorker` for the worker's own turn, after the worker's pending asks are declined.

Tests, in `packages/agent-claude/test/agent-claude-subagent.test.ts`:

- `settles an ask no scope claimed as skipped when the lead turn completes`: a `canUseTool` ask with an unknown `toolUseID` and `agentID` lands on the lead turn; after `result` the kept call is `cancelled` with reason `skipped`, `inputNeeded` is empty, and the ask resolves `deny`.
- `settles a call still running as skipped when the lead turn completes`: a `tool_use` with no result, then `result`; the kept call is `cancelled`, `skipped`, without `confirmed`.
- `settles an ask no scope claimed as skipped when the lead turn is cancelled`: the same ask, then `cancel('t1')`.

Failed first: all three, the kept call still `pending-confirmation` (the two ask cases) or `running`.

Not tested: the worker case.
A worker's kept turn is dropped with its scope when it ends and is read by nothing afterwards, and the host builds the worker chat's state with the protocol reducer, which already cancels its open calls on the worker's end action; so there is no state a test can observe changing.
`endWorker` calls `settleOpen` anyway so the backend's record agrees; confirm whether a test is wanted, and through which surface.

Consistent with claude/06: a worker stopped through `stopTask` ends through `endWorker` on its `stopped` notification, and the `workerStop: "session"` path goes through `cancel`, so both settle their open calls.

Gates: `pnpm typecheck` clean; `pnpm boundary` clean; `pnpm test` 107 files, 1552 tests passed.
One earlier full run, while the machine's load average was above 30 from other work, failed ten unrelated timing-bound tests (changeset watches, computer installs, CLI completions) at 13 to 56 seconds each; the rerun straight after passed every test.
