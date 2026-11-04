---
title: The bot chat shows a steer
status: implemented
depends: []
layer: bot
refs:
  - "[code://packages/bot/src/chat.ts#L1195-L1205](../../../../packages/bot/src/chat.ts#L1195-L1205) - `steer`"
  - "[code://packages/bot/src/chat.ts#L845-L851](../../../../packages/bot/src/chat.ts#L845-L851) - `say`, the pattern"
---

## Objective

A steer into the bot chat's open turn adds a quote part to that turn, which every client sees and a reload reads back.

## Files

- `CREATE: packages/sdk/src/sessions/steer.ts` - `steerQuote`, the quote part both packages build.
- `UPDATE: packages/sdk/src/index.ts` - export `steerQuote`.
- `UPDATE: packages/bot/src/chat.ts:1195-1205` - `steer` adds the quote part to the open turn, says it with `chat/responsePart`, and logs `steeringId`.
- `UPDATE: packages/bot/src/chat.ts:380-392` - the reader adds the quote to the turn a steering line names, when that turn has no part with the quote's id.
- `UPDATE: packages/bot/test/bot-chat.test.ts` - a case for the live quote, and a case for the read back.
- `DELETE: .project/problems/a-bot-steer-shows-differently-after-a-reload.md` - bots/20261103-0650 covered it.

## Steps

1. Add `steerQuote(id, text)` to `@ahpd/sdk`, which returns a markdown part with id `steer:<id>` and `> ` before each line of the text.
2. In `steer`, push the quote into the open turn's `responseParts`, and emit `chat/responsePart` for it.
3. In the reader, add the quote to the turn a steering line names, if it has none.
4. Add the live case: the open turn holds the quote after a steer, and a client got `chat/responsePart`.
5. Add the read back case: the chat read from the log holds the quote in the turn it went into.

## Validation

- The two new cases fail without the change and pass with it.
- `pnpm --filter @ahpd/bot test` passes, run alone.

## Resume

- **Done so far:** every step. A log line written before this change names no `steeringId`, so its quote gets the id `steer:<turn id>:<n>` and goes after what the turn holds.
