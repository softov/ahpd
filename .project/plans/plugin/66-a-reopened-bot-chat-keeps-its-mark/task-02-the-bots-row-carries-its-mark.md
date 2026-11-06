---
title: The bot's row carries its mark
status: done
depends: [task-01-a-listed-row-carries-meta.md]
layer: "bot"
refs:
  - "[code://packages/bot/src/chat.ts#L238-L245](../../../../packages/bot/src/chat.ts#L238-L245) - `markOf`"
  - "[code://packages/bot/src/chat.ts#L387-L408](../../../../packages/bot/src/chat.ts#L387-L408) - `rowOf`, used by `list` and `find`"
  - "[code://packages/bot/test/bot-catalogue.test.ts](../../../../packages/bot/test/bot-catalogue.test.ts) - the bot listing tests"
---

## Objective

A bot chat that is not running is listed with its bot's mark, so a client draws it as a bot chat.

## Files

- `UPDATE: packages/bot/src/chat.ts:387-408` - set the row's `_meta` to the mark.
- `UPDATE: packages/bot/test/bot-catalogue.test.ts` - the cases below.

## Steps

1. Set `_meta` in `rowOf` to `markOf(bot)` when the store has the bot.
2. Set `_meta` to `log.mark` when the store has no bot and the log has a mark.
3. Leave `_meta` out when neither has a mark.
4. Run `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`, then restore `packages/sdk/test/fixtures/wire.jsonl`.

## Validation

- A test lists a chat of an existing bot, and its `_meta` equals `markOf` of the bot now.
- A test removes a bot, lists its chat, and gets the mark of the log in `_meta`.
- A test finds one chat by `find`, and its row carries the same `_meta` as in the listing.
- A host test lists a chat that is not running, and its summary `_meta` holds `bot`, `name` and `color`.

## Resume

- **Done so far:** `rowOf` sends `markOf(bot)` when the store has the bot, `log.mark` when it does not, and no `_meta` when neither has one.
- **Next action:** none, this task is implemented.
- **Files:** `packages/bot/src/chat.ts`, `packages/bot/test/bot-catalogue.test.ts`.
- **Open questions:** none.
- **Departures:** the host-level case grants the reader `session:list` beside `PERSON`, because `listSessions` asks for it and the bot grants are `bot:write` and `session:create`.
- **Watch out for:** the mark goes on the row whole, never merged, and the log's mark answers only when the bot is gone.
