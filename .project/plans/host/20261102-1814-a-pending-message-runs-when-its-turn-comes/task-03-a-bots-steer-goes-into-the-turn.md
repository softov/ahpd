---
title: A bot's steer goes into the open turn
status: todo
depends: []
layer: bot
refs:
  - "[code://packages/bot/src/chat.ts#L1007-L1042](../../../../packages/bot/src/chat.ts#L1007-L1042) - the bot's `steer`"
  - "[code://packages/bot/src/chat.ts#L352-L372](../../../../packages/bot/src/chat.ts#L352-L372) - the reader of a steering line"
  - "[code://packages/bot/src/wake.ts#L549-L562](../../../../packages/bot/src/wake.ts#L549-L562) - the wake, which follows the turn a message names"
---

## Objective

A bot's steer is said as the chat's steering message, handed into the open turn, and taken out once handed on.
The open turn goes on, and the back session's answer lands in it.
The steer is kept on a log line against that turn, so a chat read back after a restart shows it.

## Files

- `UPDATE: packages/bot/src/chat.ts:1007-1042` - `steer` hands the message into the open turn and keeps it on a line.
- `UPDATE: packages/bot/src/chat.ts:28-37` - the module comment on what the log holds.
- `UPDATE: packages/bot/src/chat.ts:352-362` - the reader's comment.
- `UPDATE: packages/bot/src/wake.ts:549-562` - the wake's comments on a steer.
- `UPDATE: packages/bot/test/bot-chat.test.ts:394-527` - the steer cases.
- `UPDATE: packages/bot/test/bot-chat.test.ts:736-828` - the subagent call a steer keeps.
- `UPDATE: packages/bot/test/bot-wake.test.ts:318-340` - the steer names the open turn.
- `UPDATE: docs/sdk/CHATS.md:51` - the bot's sentence in *Turns*.

## Steps

1. Say the steering message, write its line, and hand it to `onMessage` under the open turn's id.
2. Say it taken out once handed on.
3. Change the four steer cases and the subagent case to read one open turn.
4. Change the wake's case to name the open turn.
5. Change the comments and `CHATS.md` to say a steer goes into the open turn.

## Validation

- `packages/bot/test/bot-chat.test.ts`: the changed steer case fails on `89ebe4d5` and passes after.
- The bot test files pass.
- `pnpm run typecheck` is clean.

## Resume
