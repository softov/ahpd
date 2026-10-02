---
title: claude counts every call
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L1341-L1362](../../../../packages/agent-claude/src/session.ts#L1341-L1362) - where each API call's usage arrives"
  - "[code://packages/agent-claude/src/session.ts#L2668-L2675](../../../../packages/agent-claude/src/session.ts#L2668-L2675) - the end-of-turn emit"
---

## Objective

Each `message_delta` adds its call's usage to the turn and sends the running total; the `result` adds the turn's cost from `modelUsage`.

## Files

- `UPDATE: packages/agent-claude/src/session.ts:1215-1225` - `usageOf` also reads `cache_creation_input_tokens` into `_meta.cacheWriteTokens`.
- `UPDATE: packages/agent-claude/src/session.ts:1341-1362` - keep each call's `message_start` usage and add its `message_delta` usage to a per-turn sum, subagent calls included; emit `chat/usage` with the sum.
- `UPDATE: packages/agent-claude/src/session.ts:2668-2675` - the end emit sends the sum, plus `_meta.cost` from the change in `modelUsage[*].costUSD` since the last `result`, left out when any model's `costBasis` is `unknown`.

## Steps

1. Check in the SDK types how `message_start.message.usage` and `message_delta.usage` split input and output, so input is not counted twice.
2. Keep the per-turn sum beside the turn; reset it when a turn starts.
3. Keep the last `modelUsage` cost per query to take the difference at each `result`.

## Validation

- new `packages/agent-claude/test/agent-claude-usage.test.ts`: a turn with two API calls and a subagent call sends three growing `chat/usage` actions and an end total equal to their sum; cache writes and cost appear in `_meta`; `costBasis: 'unknown'` sends no cost.
- `pnpm -F @ahpd/agent-claude test`.

## Resume
