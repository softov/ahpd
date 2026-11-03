---
title: A steer keeps the back turn
status: implemented
depends: []
layer: bot
refs:
  - "[code://packages/bot/src/wake.ts#L593-L680](../../../../packages/bot/src/wake.ts#L593-L680) - `woken`"
  - "[code://packages/bot/test/bot-wake.test.ts](../../../../packages/bot/test/bot-wake.test.ts) - the wake cases"
---

## Objective

A message into a main turn that the wake already answers goes to the back session as a steer.
A refused steer keeps the binding.

## Files

- `UPDATE: packages/bot/src/wake.ts` - `woken` names `held`, steers when it holds the main turn, and keeps the binding on a refused steer.
- `UPDATE: packages/bot/test/bot-wake.test.ts` - a case for a steer before the status says working, and a case for a refused steer.

## Steps

1. In `woken`, set `held` when `answering` holds the same handle and main turn for the session.
2. Send a steer when `looked.working` or `held` is true.
3. On a refused send with `held`, keep the entry, report a problem line and return.
4. Add the two cases to `bot-wake.test.ts`.

## Validation

- `bot-wake.test.ts`: the steer case sends `chat/pendingMessageSet`, and the refused case ends no main turn and still posts.
- `pnpm --filter @ahpd/bot test` passes, run alone.
- `pnpm typecheck` and `pnpm boundary` pass.

## Resume

- **Done so far:** every step. Both cases fail without the change and pass with it. The bot package passes 232 tests.
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** `bot-chat.test.ts` needs `tools/ahp.strict.schema.json`, which `pnpm schema` writes.
