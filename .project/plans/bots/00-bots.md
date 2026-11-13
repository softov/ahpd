---
title: Bots - what exists today
domain: bots
revalidated: 2026-10-28
---

A bot is a record with a folder, a template and a session that the host starts for it.
The `bot` plugin in `packages/bot` implements it, and [specs/bots.md](../../specs/bots.md) says what it does.
The first bot plans were children of [plugin/52](../plugin/52-a-bot-manages-and-delegates/plan.md), and plugin/47 was a plugin plan.
Softov made this domain on 2026-10-28, and the open bot drafts moved here.

## Glossary

| Term | Meaning |
| --- | --- |
| bot | A `bot://<slug>` record, with its folder, its template and its owner. |
| folder | The working folder of a bot, which holds its `AGENTS.md`. |
| machine | The computer where a bot's sessions run, from the `computer` field. |
| Front | The chat where a person and a bot talk. The `bot-chat` agent serves it, with no model. |
| Back | A chat where a harness does a bot's work and replies to the Front with `post_message`. |
| wake | The start of a bot's session and turn, when a message arrives for the bot. |
| private session | The one session of a bot where no person chats, for each wake with no person behind it. |

## Packages

- [`code://packages/bot`](../../../packages/bot) - the `bot` plugin; its entry point is `src/plugin.ts`, and its contracts file is `src/record.ts`.

## Contracts

- [`code://packages/bot/src/record.ts#L145`](../../../packages/bot/src/record.ts#L145) - `BotRecord`, the shape of a bot that the provider reads and writes.
- [`code://packages/bot/src/wake.ts#L221-L234`](../../../packages/bot/src/wake.ts#L221-L234) - `sessionFor`, the session request for a bot.
- [`code://packages/bot/src/chat.ts#L192`](../../../packages/bot/src/chat.ts#L192) - `CHAT_PROVIDER`, the `bot-chat` provider of a Front.

## Runtime path

```
resourceWrite bot://<slug> -> botProvider.write -> makeFolder -> message to the Front -> wake -> sessionFor -> host start -> Back turn -> post_message -> Front
```

## Tests

- [`code://packages/bot/test`](../../../packages/bot/test) - one file for each module of the plugin, such as `bot-wake.test.ts` and `bot-provider.test.ts`.

## Known gaps

- A bot's machine is not checked, and a bot from a profile has no machine of its own ([plan](20261028-0545-a-bot-runs-in-a-machine/plan.md)).
- A wake session of a manager bot can edit outside the bot's folder ([plan](20261028-0545-a-manager-bot-edits-only-its-own-folder/plan.md)).
- A bot has no tool that makes a bot or changes a bot's record ([plan](20261028-0545-a-bot-changes-bots-with-a-tool/plan.md)).
- A talk with a bot is not one session with its Back chats ([plan](20261113-0817-a-bot-talk-is-one-session-with-back-chats/plan.md)).
- A bot has no private session, groups or wakes with no person behind them ([plan](20261028-0545-a-bot-session-has-a-front-and-backs/plan.md)).
