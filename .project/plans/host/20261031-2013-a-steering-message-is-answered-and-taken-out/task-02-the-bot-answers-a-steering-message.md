---
title: The bot answers a steering message and names it on the turn that takes it in
status: todo
depends: []
layer: bot
refs:
  - "[code://packages/bot/src/chat.ts#L990-L1009](../../../../packages/bot/src/chat.ts#L990-L1009) - the bot's `steer`"
---

## Objective

A steering message a client sends while a bot turn is open is said back inside the dispatch, and the turn that takes it in carries `queuedMessageId` naming it.

## Files

- `UPDATE: packages/bot/src/chat.ts` - `steer` says the message, then ends the open turn and starts the next with the message's id as its `queuedMessageId`.
- `UPDATE: packages/bot/test/bot-chat.test.ts` - the message said with its sender's origin, and the new turn naming it.

## Steps

1. Write the case and run it on `ab07054c` to see nothing said for the message and a turn that names nothing.
2. Say the message and name it on the turn.

## Validation

- The new case fails on `ab07054c` and passes after the change.
- The bot suite passes.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Resume
