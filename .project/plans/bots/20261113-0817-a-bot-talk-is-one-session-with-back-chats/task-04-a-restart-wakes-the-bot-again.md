---
title: A restart wakes the bot again
status: implemented
depends:
  - task-03-the-back-is-a-chat-of-the-front.md
layer: "bot"
refs:
  - "[code://packages/bot/src/chat.ts#L522-L541](../../../../packages/bot/src/chat.ts#L522-L541) - a Front opens from its log with no turn open"
  - "[code://packages/bot/src/wake.ts#L549-L558](../../../../packages/bot/src/wake.ts#L549-L558) - the queued message the wake sends again"
---

## Objective

After a restart, a Front turn the log never ended is open again.
The bot wakes its Back again, and the reply lands in that turn.

## Files

- `UPDATE: packages/bot/src/chat.ts:522-541` - open the last turn the log began and never ended, and hand it to the listener.
- `UPDATE: packages/bot/src/wake.ts` - wake the Back again for a reopened turn.
- `UPDATE: packages/bot/test` - the cases in *Validation*.

## Steps

1. When a Front opens, read its log for a turn begun and never ended.
2. Open that turn as the chat's `activeTurn`, with its id and the person's message.
3. Hand the turn to the listener, as `chat.ts` hands a new message.
4. In the wake, send the message to the Back chat again, as the wake sends a new one.
5. Wake each Front with such a turn when the plugin loads, so nobody has to open it first.

## Validation

- A test writes a log with a turn begun and not ended, starts the plugin, and the turn is open.
- A test then lets the Back post, and the text lands in that same turn.
- A test with a log whose last turn ended opens no turn.
- `pnpm typecheck` passes, and `pnpm vitest run packages/bot` passes.

## Resume

- Built on 2026-11-13. `logAt` answers the open last turn, and `chat()` opens it again where it has a listener, in the default chat only. The plugin opens such talks on `listening` through `openTalks`.
- Cases in `bot-chat.test.ts`. A restart of a real daemon is not tested: it is a check by hand on the test daemon.

