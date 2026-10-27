---
title: A bot part is the protocol's
status: todo
depends: []
layer: "bot"
refs:
  - "[code://packages/bot/test/bot-chat.test.ts](../../../../packages/bot/test/bot-chat.test.ts) - the cases for a chat with a bot"
---

## Objective

Every tool call part of a bot chat holds `kind` and `toolCall`.

## Files

- `UPDATE: packages/bot/src/chat.ts:501-507` - the call that shows the back session has no `id`.
- `UPDATE: packages/bot/src/chat.ts:604` - the call a back session asks about has no `id`.
- `UPDATE: packages/bot/test/bot-chat.test.ts` - the case through the host.

## Steps

1. Remove `id` from the two literals that make a tool call part.
2. Add the case: a turn that wakes a back session, with the frames and the late calls checked.

## Validation

- Test in `packages/bot/test/bot-chat.test.ts` that the protocol declares every frame, and that the late calls equal the replayed calls.
- Run the case on the chat before this change, and see it fail.
- The bot suite passes.

## Resume

