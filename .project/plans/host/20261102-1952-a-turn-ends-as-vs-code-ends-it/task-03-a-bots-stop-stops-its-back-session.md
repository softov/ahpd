---
title: A bot's stop stops its back session
status: todo
depends: []
layer: bot
refs:
  - "[code://packages/bot/src/chat.ts#L1068-L1072](../../../../packages/bot/src/chat.ts#L1068-L1072) - a bot's stop ends its turn alone"
  - "[code://packages/bot/src/wake.ts#L52-L58](../../../../packages/bot/src/wake.ts#L52-L58) - `Looked`, what the wake reads of a back session"
  - "[code://packages/bot/src/plugin.ts#L506-L523](../../../../packages/bot/src/plugin.ts#L506-L523) - the plugin's `look`"
---

## Objective

A client's stop of a bot's turn stops the back session's running turn too.
The cancel carries the time the bot timed that turn, or zero for one it did not begin.
The back session answers the stopped turn no more.

## Files

- `UPDATE: packages/bot/src/chat.ts:160-201` - `TurnHandle.onStop`.
- `UPDATE: packages/bot/src/chat.ts:465` - `botChatAgent` sets each handle's `onStop`.
- `UPDATE: packages/bot/src/chat.ts:1068-1072` - a stop tells the handle's holder.
- `UPDATE: packages/bot/src/wake.ts` - `Looked.turn`, a clock per back turn begun, and `stopped`.
- `UPDATE: packages/bot/src/plugin.ts:506-523` - `look` reads the running turn's id, and a stop goes to the wake.
- `UPDATE: packages/bot/test/bot-wake.test.ts` - a stopped main turn cancels the back session's turn.
- `UPDATE: packages/bot/test/bot-chat.test.ts` - a stop reaches the handle's holder.

## Steps

1. Add `onStop` to the handle, and call it from `cancel`.
2. Read the running turn's id in `look`.
3. Time each turn the wake begins in a back session.
4. Cancel the running turn of each back session answering the stopped turn, and forget that turn.
5. Pass the stop from the plugin to the wake.
6. Add the two cases.

## Validation

- The two cases fail on `98c13ce0` and pass after.
- The bot's test files pass.
- `pnpm run typecheck` is clean.
