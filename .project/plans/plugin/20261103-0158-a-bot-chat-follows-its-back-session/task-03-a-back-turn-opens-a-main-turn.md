---
title: A back turn opens a main turn
status: todo
depends:
  - task-02-a-withdrawn-copy-clears-at-once.md
layer: bot
refs:
  - "[code://packages/bot/src/chat.ts#L746-L850](../../../../packages/bot/src/chat.ts#L746-L850) - the handle and `beginTurn`, which `begin` reuses"
  - "[code://packages/bot/src/chat.ts#L438-L458](../../../../packages/bot/src/chat.ts#L438-L458) - `turns`, the handle of a running chat"
  - "[code://packages/bot/src/names.ts#L146-L198](../../../../packages/bot/src/names.ts#L146-L198) - `BackSessions`, which gains a lookup by session"
  - "[code://packages/bot/src/names.ts#L99](../../../../packages/bot/src/names.ts#L99) - `whose`, the owner of a row's `user`"
  - "[code://packages/bot/src/wake.ts#L557-L570](../../../../packages/bot/src/wake.ts#L557-L570) - the `answering` entry and `working` of a woken turn, which `began` copies"
  - "[code://packages/bot/src/plugin.ts#L583-L608](../../../../packages/bot/src/plugin.ts#L583-L608) - the `turn_end` listener, which the `turn_start` listener copies"
  - "[code://packages/sdk/src/types/events.ts#L98-L111](../../../../packages/sdk/src/types/events.ts#L98-L111) - `TurnStartEvent`"
  - "[code://packages/bot/test/bot-wake.test.ts](../../../../packages/bot/test/bot-wake.test.ts) - the wake tests"
---

## Objective

A turn that a person starts on a bot's back session opens a turn in that person's main chat with the bot.
The main turn shows the back session working, its requests and its answer, as a woken turn does.

## Files

- `UPDATE: packages/bot/src/chat.ts:160-200` - `TurnHandle` gains `begin(text, from?)`, which opens a turn without calling `onMessage`.
- `UPDATE: packages/bot/src/chat.ts:746-850` - the handle's `begin`, over `beginTurn`, refused when a turn is open.
- `UPDATE: packages/bot/src/names.ts:146-198` - `BackSessions` gains `of(bot, session)`, the row that names the session.
- `UPDATE: packages/bot/src/wake.ts` - `began(backSession, handle, turnId)`, which holds the main turn in `answering` and shows `working`.
- `UPDATE: packages/bot/src/plugin.ts:583` - a `turn_start` listener beside the `turn_end` listener.
- `UPDATE: packages/bot/test/bot-chat.test.ts` - the cases for `begin`.
- `UPDATE: packages/bot/test/bot-names.test.ts` - the case for `of`.
- `UPDATE: packages/bot/test/bot-wake.test.ts` - the cases for `began`, with `posted` and `finished` after it.

## Steps

1. Add `begin(text: string, from?: MessageFrom): string | undefined` to `TurnHandle`, with a comment.
2. Make the handle's `begin` return `undefined` when a turn is open.
3. Otherwise make it call `beginTurn` with a new turn id, without `onMessage`, and return the id.
4. Split `onMessage` out of `beginTurn` so that `begin` does not wake the back session.
5. Add `of(bot, session)` to `BackSessions`, from `rows(bot).find({ bot, session })`.
6. Add `began(backSession, handle, turnId)` to the wake, which sets the `answering` entry and calls `working` as `woken` does.
7. Make `began` do nothing when `answering` already holds the back session.
8. In `plugin.ts`, listen to `turn_start` and skip a session that `wake.main` already holds.
9. Skip a session that is not a bot's back session, from the bot that `started` names.
10. Find the back row with `of`, and its owner with `whose`.
11. Find the main chat in the bot's chat row for that owner.
12. Get the handle with `turns`, and skip a main chat that this host is not running.
13. Read the back chat with `subscribe`, and take the text of the message of `event.turn`.
14. Call `handle.begin` with that text and the event's sender, then `wake.began` with the id it returns.
15. Leave `post_message`, `asking` and `turn_end` as they are, because the `answering` entry carries the turn.

## Validation

- `bot-chat.test.ts`: `begin` opens a turn and does not call `onMessage`. `begin` returns `undefined` while a turn is open.
- `bot-names.test.ts`: `of` finds the row of a session, and answers `undefined` for another bot's session.
- `bot-wake.test.ts`: after `began`, `posted` replies in the main turn, and `finished` ends it.
- `bot-wake.test.ts`: `began` does nothing while the wake waits on that back session.
- `pnpm --filter @ahpd/bot test` passes, run alone.
- `pnpm typecheck` passes.
- Check by hand on a test daemon with `XDG_CONFIG_HOME` in the scratch folder.
- A message typed on the back session opens a main turn that shows running.
- The back session's reply ends that main turn.

## Resume
