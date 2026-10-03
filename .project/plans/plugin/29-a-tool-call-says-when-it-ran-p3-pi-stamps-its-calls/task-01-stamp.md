---
title: pi tool calls carry their start and end, live and restored
status: todo
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/mapping.ts#L251](../../../../packages/agent-pi/src/mapping.ts#L251) - `mapEvent(turn, event)`, which gains the time"
  - "[code://packages/agent-pi/src/mapping.ts#L327-L332](../../../../packages/agent-pi/src/mapping.ts#L327-L332) - `tool_execution_start`, with no time kept"
  - "[code://packages/agent-pi/src/mapping.ts#L348](../../../../packages/agent-pi/src/mapping.ts#L348) - `tool_execution_end`, with no time kept"
  - "[code://packages/agent-pi/src/replay.ts#L62](../../../../packages/agent-pi/src/replay.ts#L62) - `raise`, how replay feeds `mapEvent`"
  - "[code://packages/agent-pi/src/replay.ts#L120-L185](../../../../packages/agent-pi/src/replay.ts#L120-L185) - entry times (`entry.timestamp`) used only for the turn"
---

## Objective

Live, the plugin stamps `Date.now()` on `tool_execution_start` and `tool_execution_end`. Restored, the entry times reach the replayed events so the live mapping stamps both paths the same way.

## Files

- `UPDATE: packages/agent-pi/src/mapping.ts:251` - `mapEvent(turn, event, at?: number)`; the `tool_execution_start` case (327-332) stamps the start and the `tool_execution_end` case (348) the end, at `at ?? Date.now()`.
- `UPDATE: packages/agent-pi/src/replay.ts:62` - `raise(turn, event, at)` passes the entry's `timestamp` (as epoch milliseconds) for the tool events at lines 161 and 173.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - the cases below.

## Steps

1. Failing first: the cases under Validation.
2. Stamp through the sdk helper from p1.
3. Add the `at` parameter to `mapEvent`; the live caller passes nothing.
4. In replay, pass the time of the entry that carried the call to `tool_execution_start`, and of the entry that carried its result to `tool_execution_end`.

## Validation

- A live and a replayed call both carry the three keys; the replayed call's start and end are its entries' times, not the replay's.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
