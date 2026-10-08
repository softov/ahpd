---
title: A reset conversation starts Claude's cost baseline again
status: todo
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
