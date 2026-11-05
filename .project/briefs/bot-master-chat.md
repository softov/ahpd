---
title: The bot's master chat
created: 2026-11-04
refs:
  - git://18d0a202 - the commit of ahpd the facts were checked at
  - git://18d0a202 - the last commit that holds `problems/a-bot-chat-started-from-the-form-stops.md` and `pending/session-picker-checks.md`, which this brief covers
  - "[code://packages/bot/src/chat.ts#L1476-L1492](../../packages/bot/src/chat.ts#L1476-L1492) - `create` of the `bot-chat` agent: a chat from the new session form gets a new id each time"
  - "[code://packages/bot/src/provider.ts#L551-L576](../../packages/bot/src/provider.ts#L551-L576) - `chatOf`: a chat opened from the bot is one main chat per bot and owner, in the bot's `workspace`"
  - "[code://packages/bot/src/wake.ts#L15-L40](../../packages/bot/src/wake.ts#L15-L40) - the main chat runs no model; a back session on the bot's harness does the work"
  - "[code://packages/bot/src/chat.ts#L565-L590](../../packages/bot/src/chat.ts#L565-L590) - the main turn links the back session with a `subagent` tool call"
  - "[code://packages/sdk/src/host/spawn.ts#L405-L425](../../packages/sdk/src/host/spawn.ts#L405-L425) - a worker the host spawns is a second chat of the same session, with a `tool` origin"
  - "[code://packages/sdk/src/sessions/catalog.ts#L87-L94](../../packages/sdk/src/sessions/catalog.ts#L87-L94) - a session is `ahp-session:/<uuid>`, not named by its provider"
  - "https://github.com/microsoft/agent-host-protocol/blob/2c37a04f/types/channels-chat/state.ts - `SessionState.chats` and `ChatOrigin`: one session holds many chats, each with where it came from"
---

# The bot's master chat

A chat with a bot must work, both from the bot and from the new session form.
The whole bot needs a review before a plan.
Softov, 2026-11-04: "session with bot does not. it creates a new session".
How a person reaches a bot's master chat, and how its work sessions hang under it, is not decided.
Session ids are now uuids, not provider ids, so the work could be sub-sessions: a session tree.

## What Softov saw on 2026-11-04

- From the new session form, the `Bot` picker listed each bot. The form created a new session, and that session did nothing.
- From the bot, ahpw asked for a path. At the same time a session opened for the bot chat, on the `bot-chat` harness, and it did nothing.

## What others do

- The protocol puts many chats in one session: [`SessionState.chats`](https://github.com/microsoft/agent-host-protocol/blob/2c37a04f/types/channels-chat/state.ts), with a `ChatOrigin` of `user`, `fork`, `sideChat` or `tool`. A `tool` chat names the call in its parent chat that spawned it.
- VS Code draws a `subagent` tool call as a link to the worker's chat.

## What ahpd has today

- A bot chat is a `bot-chat` session that runs no model. A back session on the bot's own harness does the work, under the name in the bot's `session` field, `work` by default. See [`code://packages/bot/src/wake.ts`](../../packages/bot/src/wake.ts).
- Opened from the bot, the chat is one per bot and owner, kept in the bot's `chats` rows, in the bot's `workspace`. See [`code://packages/bot/src/provider.ts`](../../packages/bot/src/provider.ts).
- Opened from the form, `create` takes the `bot` setting and starts a chat under the new session's own id. It is never the row's chat. See [`code://packages/bot/src/chat.ts`](../../packages/bot/src/chat.ts).
- The back session is a separate session. The main turn links it with a `subagent` tool call that names its chat.
- A worker the host spawns is a second chat of the same session, with a `tool` origin. See [`code://packages/sdk/src/host/spawn.ts`](../../packages/sdk/src/host/spawn.ts). The bot does not use this.
- Two plans touch the same code: `bots/20261028-0545-a-bot-session-has-a-front-and-backs` (draft) and `plugin/20261103-0158-a-bot-chat-follows-its-back-session` (planned, task 01 not run).

## Who writes

- `packages/bot` is written by the two plans named in *What ahpd has today*. A plan from this brief replaces or absorbs them.
- ahpw draws the bot pages and the new session form. It draws only what the host sends.

## The change

- To be decided after the review. The open points say what the review answers.

## Open points

- Why the chat from the form and the chat from the bot each do nothing. Not checked.
- Why ahpw asks for a path when the bot already has a `workspace`. Not checked.
- Whether the form and the bot open the same master chat for one person and bot.
- Where a back session goes: its own session as today, a `tool` chat of the master session, or a child in a session tree.
- What a session tree needs that the protocol does not have: a parent on a session, and how a client lists children.
