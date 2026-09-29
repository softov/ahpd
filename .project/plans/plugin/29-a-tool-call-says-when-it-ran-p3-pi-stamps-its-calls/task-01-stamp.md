---
title: pi tool calls carry their start and end, live and restored
status: todo
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/mapping.ts#L279-305](../../../../packages/agent-pi/src/mapping.ts#L279-305) - `tool_execution_start` and `end`, with no time kept"
  - "[code://packages/agent-pi/src/replay.ts#L100-185](../../../../packages/agent-pi/src/replay.ts#L100-185) - entry times used only for the turn"
---

## Objective

Live, the plugin stamps `Date.now()` on `tool_execution_start` and `tool_execution_end`. Restored, the entry times reach the replayed events so the live mapping stamps both paths the same way.

## Steps

1. Failing first: the cases under Validation.
2. Stamp through the sdk helper from p1.

## Validation

- A live and a replayed call both carry the three keys.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
