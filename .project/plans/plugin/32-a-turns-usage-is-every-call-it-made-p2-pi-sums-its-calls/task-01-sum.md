---
title: pi sums its calls
status: done
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

**Implemented 2026-10-01.**

- `mapping.ts`: new `addUsage(total, message)`, which adds one message's usage to the running sum and returns it. `usageOf` is untouched and still maps one message, so `replay.ts` keeps reading a restored turn's last answer as before. Fields summed: `inputTokens`, `outputTokens`, `cacheReadTokens`, `_meta.cacheWriteTokens`, and the cost. A count no call reported is left out rather than sent as zero, and the model is the last call's (falling back to the one held).
- `_meta.cost` is `{ amount, currency: 'USD' }`, the amount being the sum of `usage.cost.total`, which pi prices in dollars (`pi-ai`'s own README prints it as `$${cost.total}`). The protocol names no field for it, which is why it rides `_meta` beside the cache write.
- `session.ts`: `spent` holds the turn's sum, cleared in `begin`. Each assistant `message_end` adds to it and, when the call actually used something, sets `active.usage` and `watched.usage` and emits `chat/usage`. `addUsage` hands the sum back unchanged for a call that used nothing (the all-zero report of a call that failed before the provider answered), and the identity check is what keeps that call from re-sending the same number. `agent_settled` emits the sum again, before the ending action, as the task asks.
- Tests: `test/agent-pi-usage.test.ts` - a turn of three calls sends four usages (three growing, one at the settle) whose counts equal the per-call sums, with the cost summed in USD; the total is sent before `chat/turnComplete` and is what the transcript keeps; the model reported is the last call's; a failed all-zero call sends nothing and the turn still ends as `chat/error`; a second turn starts from nothing.

**What the plan did not know**

- The cost rides only on the live path. A turn read back from pi's file by `replay.ts` still gets `usageOf`, so a restored turn has no `_meta.cost` even when its transcript has one per message. This follows the parent plan's "restored turns keep the usage their transcripts give today", but summing them there is a one-line change if it is wanted later.
- `chat/usage` is emitted once per call *and* once at the settle, so the last two usages of a turn are equal. The protocol's reducer replaces the turn's usage, so this is a no-op for a client; the task's Objective asks for the final send, and it also means a client joining late gets the whole turn's usage on its first message.
- Not run here: no live pi turn, so the sums are checked against raised events only. The per-call `cost.total` pi computes was not verified against a provider bill.
