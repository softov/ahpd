---
title: A reset conversation starts Claude's cost baseline again
status: done
depends: [task-02-claude-sends-no-cost-for-nothing-spent.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session/parts.ts#L160-L200](../../../../packages/agent-claude/src/session/parts.ts#L160-L200) - `paid`, the `costUSD` baseline per model, which moves only up since task 02"
  - npm://@anthropic-ai/claude-agent-sdk@0.3.278 - `SDKConversationResetMessage`, sent by /clear, a plan-mode exit and a fresh session
---

## Objective

After a `conversation_reset` message, the next `result` bills what it spent, not nothing.
Today the CLI's running total starts again at 0 after `/clear`, and the baseline stays above it.
The turns after it are billed nothing until the total climbs past the old figure.

## Files

- `UPDATE: packages/agent-claude/src/session/parts.ts` - clear `paid` when a `conversation_reset` message arrives.
- `UPDATE: packages/agent-claude/test/agent-claude-usage.test.ts` - the cases below.

## Steps

1. Write the tests below; the first one fails.
2. Find where the session reads SDK messages by `type`, and clear `paid` on `conversation_reset`.

## Validation

- A test: a `result` at $1.00, then `conversation_reset`, then a `result` at $0.20 sends a cost of $0.20.
- A test: a zeroed `result` with no reset before it still sends no cost, as task 02 requires.
- `npx vitest run packages/agent-claude` passes.

## Resume

2026-10-08. One case in `packages/agent-claude/test/agent-claude-usage.test.ts`. A `result` at $1.00, a zeroed `result` behind it that still sends no cost, then a `conversation_reset` and a `result` at $0.20 that sends a cost of $0.20. The twenty cents is well under the one-dollar baseline, so only a baseline taken back to zero reads it as the spend it is; with the clearing removed the case fails, and the nine cases already in the file hold. The `conversation_reset` message is read in `consume()` in `packages/agent-claude/src/session/query.ts`, which calls a `newConversation` added to the parts beside `newTurn`; that clears the `paid` map in `packages/agent-claude/src/session/parts.ts`. A departure from Files: `parts.ts` holds `paid` and so holds the clearing, but the dispatch that reads SDK messages by `type` is in `query.ts`, which is where the message has to be named - `parts.ts` never sees a frame. The zeroed rule of task 02 is untouched: a zeroed `result` with no reset before it still sends no cost, because the baseline only moves for a model a result spent on.
