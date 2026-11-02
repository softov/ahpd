---
title: The message is handed on whole
status: todo
depends: []
layer: "bot"
refs:
  - "[code://packages/bot/src/chat.ts](../../../../packages/bot/src/chat.ts) - `ChatMessage`, `messageOf` and `beginTurn`"
  - "[code://packages/bot/src/wake.ts](../../../../packages/bot/src/wake.ts) - `turn` and `steer`"
---

## Objective

The bot chat tells whoever answers it the model, the agent and the attachments of a message.
The back session's turn and steer carry them beside the person's words.

## Files

- `UPDATE: packages/bot/src/chat.ts` - `ChatMessage` and a held message carry the model, the agent and the attachments.
- `UPDATE: packages/bot/src/wake.ts` - the back session's message is built from the whole message.
- `UPDATE: packages/bot/test/bot-chat.test.ts` - the handle is told the whole message.
- `UPDATE: packages/bot/test/bot-wake.test.ts` - the back session is handed the whole message.

## Steps

1. Pass the model and the attachments from `begin`, `queue` and `steer` to `beginTurn`.
2. Tell `onMessage` the model, the agent and the attachments.
3. Build the back session's message with the context block and the rest of the message.

## Validation

- `pnpm exec vitest run packages/bot/test/bot-chat.test.ts packages/bot/test/bot-wake.test.ts` - passes; the new cases fail on c3c8c3e4.
