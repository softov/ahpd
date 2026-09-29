---
title: Claude tool calls carry their start and end, live and restored
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L1410-1797](../../../../packages/agent-claude/src/session.ts#L1410-1797) - tool start, then complete, where the SDK message timestamps are dropped"
  - "[code://packages/agent-claude/src/transcript.ts#L225-343](../../../../packages/agent-claude/src/transcript.ts#L225-343) - `buildTurns`: frame timestamps give only the turn's `startedAt`; tool calls get none, turns get no `duration`"
---

## Objective

Live, a call's start is when it starts running, after any approval, on the plugin's clock, and its end is when it completes. Restored, a call takes its `tool_use` frame time as start and its `tool_result` frame time as end, and each restored turn gets its `duration`.

## Steps

1. Failing first: the cases under Validation.
2. Stamp through the sdk helper from p1.

## Validation

- A live call and a restored call both carry the three keys; every `_meta` the plugin sends after the start (`progressMessage` included) still has them.
- A restored turn has `duration`.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
