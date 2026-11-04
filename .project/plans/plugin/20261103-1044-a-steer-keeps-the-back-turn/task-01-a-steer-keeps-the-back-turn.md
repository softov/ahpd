---
title: A steer keeps the back turn
status: done
depends: []
layer: bot
refs:
  - "[code://packages/bot/src/wake.ts#L523-L548](../../../../packages/bot/src/wake.ts#L523-L548) - the message the back session is handed"
  - "[code://packages/bot/src/wake.ts#L702-L757](../../../../packages/bot/src/wake.ts#L702-L757) - `woken`"
  - "[code://packages/bot/src/chat.ts#L1195-L1205](../../../../packages/bot/src/chat.ts#L1195-L1205) - `steer`"
  - "[code://packages/bot/test/bot-wake.test.ts](../../../../packages/bot/test/bot-wake.test.ts) - the wake cases"
---

## Objective

A message the person steered into the main turn goes to the back session as a steer.
A message that began a main turn goes queued.
A refused steer keeps the binding.

## Files

- `UPDATE: packages/bot/src/chat.ts` - `ChatMessage` gets `steered`, and `steer` sets it.
- `UPDATE: packages/bot/src/wake.ts` - `queued` becomes `pending`, whose kind follows `steered`; `woken` keeps a steer out of `waiting` and keeps the binding on a refused steer.
- `UPDATE: packages/bot/test/bot-wake.test.ts` - a case for a steer, and a case for a refused steer.

## Steps

1. Add `steered?: boolean` to `ChatMessage`, and set it in `steer`.
2. Rename `queued` to `pending`, and set its kind to `steering` when `message.steered` is true.
3. In `woken`, add the id to `waiting` only when the message is not a steer into the bound main turn.
4. On a refused steer into the bound main turn, keep the entry, report a problem line and return.
5. Add the two cases to `bot-wake.test.ts`.

## Validation

- `bot-wake.test.ts`: the steer case sends `chat/pendingMessageSet` `steering`, and the refused case ends no main turn and still answers.
- `pnpm --filter @ahpd/bot test` passes, run alone.
- `pnpm typecheck` and `pnpm boundary` pass.

## Resume

- **Done so far:** every step, again on main after plan bots/20261103-1008 made every message queued.
- **Watch out for:** `bot-chat.test.ts` needs `tools/ahp.strict.schema.json`, which `pnpm schema` writes.
