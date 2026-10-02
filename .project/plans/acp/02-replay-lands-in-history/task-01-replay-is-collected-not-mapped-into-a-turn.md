---
title: Replay is collected, not mapped into a turn
status: done
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session.ts#L851-L869](../../../../packages/agent-acp/src/session.ts#L851-L869) - `begin`"
  - "[code://packages/agent-acp/src/session.ts#L277-L282](../../../../packages/agent-acp/src/session.ts#L277-L282) - the update handler"
---

## Objective

`mapping` is set only after `open()` resolves, and updates that arrive during a load are kept in a replay list whatever triggered the open.

## Files

- `UPDATE: packages/agent-acp/src/session.ts:277-282, 851-869`.

## Steps

1. Move the assignment after `open()`.
2. Route updates to the replay list while opening.

## Validation

- A fixture that replays two turns on load: the first new turn holds only its own answer.
- A load started by `setConfig` keeps its replay.
