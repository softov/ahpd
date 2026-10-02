---
title: pi sums its calls
status: todo
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/session.ts#L518](../../../../packages/agent-pi/src/session.ts#L518) - where each call ends"
  - "[code://packages/agent-pi/src/mapping.ts#L141-L163](../../../../packages/agent-pi/src/mapping.ts#L141-L163) - the mapping to the protocol"
---

## Objective

Each assistant `message_end` adds to the turn's sum and sends it; `agent_settled` sends the final sum.

## Files

- `UPDATE: packages/agent-pi/src/mapping.ts:141-163` - a function that adds one message's usage to a running sum, carrying `cacheWriteTokens` and `cost.total` as `_meta.cost` in USD.
- `UPDATE: packages/agent-pi/src/session.ts:518` - add to the sum and emit `chat/usage`, instead of overwriting `answered`.
- `UPDATE: packages/agent-pi/src/session.ts:575-589` - emit the final sum; reset it at turn start.

## Steps

1. Keep `model` from the last call; a turn that switched models mid-way reports the last one.
2. Skip all-zero failed calls as today.

## Validation

- new `packages/agent-pi/test/agent-pi-usage.test.ts`: a turn with three calls sends three growing totals, the last equal to the sum, with cost.
- `pnpm -F @ahpd/agent-pi test`.

## Resume
