---
title: The reader reads the turn it steered
status: doing
depends: []
layer: bot
refs:
  - "[code://packages/bot/src/chat.ts#L339-L375](../../../../packages/bot/src/chat.ts#L339-L375) - `logAt`"
---

## Objective

A `steering` line is the record that a message was said in the turn it names, and the chat read back shows that turn.

## Files

- `UPDATE: packages/bot/src/chat.ts:355-372` - `logAt` reads a `steering` line for its mark alone.
- `UPDATE: packages/bot/test/bot-chat.test.ts:428-466` - the live steer's chat read back shows the turn it went into.
- `UPDATE: packages/bot/test/bot-chat.test.ts:543-569` - a line written before the live chat changed reads the same way.
- `UPDATE: docs/sdk/CHATS.md:55` - what a chat read back shows of a steer.

## Steps

1. Read a `steering` line for its mark and nothing else.
2. Change the two cases that held the turn of its own.
3. Write what a chat read back shows in `CHATS.md`.

## Validation

- The two changed cases fail on `a8eff676` and pass after.
- The bot's test files pass, one at a time.
- `pnpm run typecheck` is clean.

## Resume
