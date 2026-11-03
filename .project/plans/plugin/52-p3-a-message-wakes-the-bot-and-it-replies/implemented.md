---
title: A message wakes the bot and it replies - implemented
date: 2026-11-02
refs:
  - git://2422231e - the last commit of the plan's tasks, task 08
  - "[code://packages/bot/src/wake.ts](../../../../packages/bot/src/wake.ts)"
  - "[code://packages/bot/src/post.ts](../../../../packages/bot/src/post.ts)"
  - "[code://packages/bot/src/ask.ts](../../../../packages/bot/src/ask.ts)"
  - "[code://packages/bot/src/chat.ts](../../../../packages/bot/src/chat.ts)"
  - "[code://packages/bot/src/names.ts](../../../../packages/bot/src/names.ts)"
  - "[code://packages/bot/src/context.ts](../../../../packages/bot/src/context.ts)"
  - "[code://packages/bot/src/agents.ts](../../../../packages/bot/src/agents.ts)"
  - "[code://packages/bot/src/template.ts](../../../../packages/bot/src/template.ts)"
  - "[code://docs/plugins/BOTS.md](../../../../docs/plugins/BOTS.md)"
---

A message in a bot's main chat wakes a back session, and the back session answers with `post_message`. The main turn stays open while the back session works, shows it as a subagent call, and asks its questions in the main chat.

## What was built

- [`code://packages/bot/src/names.ts`](../../../../packages/bot/src/names.ts) - the main chat is `bot:/<bot>/<user>`, and a back session's name is filled from the message, with `{turn}` as one example.
- [`code://packages/bot/src/wake.ts`](../../../../packages/bot/src/wake.ts) - a message starts or reuses a back session, and starts a session again when it is gone.
- [`code://packages/bot/src/post.ts`](../../../../packages/bot/src/post.ts) - `post_message` ends the main turn with its text. It finds the main chat from the calling session, and runs with `confirm: false`.
- [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts) - the main turn stays open, and shows the back session as a `subagent` call. A turn with no post ends as `mainTurnPostMessageAbsent` says.
- [`code://packages/bot/src/ask.ts`](../../../../packages/bot/src/ask.ts) - a back session's approval or question is copied into the main turn, and the answer goes back to the back session.
- [`code://packages/bot/src/context.ts`](../../../../packages/bot/src/context.ts) - each woken message has a `<context>` block with the main chat, the person and the time.
- [`code://packages/bot/src/agents.ts`](../../../../packages/bot/src/agents.ts) and [`code://packages/bot/src/template.ts`](../../../../packages/bot/src/template.ts) - a bot's folder has its `AGENTS.md`, made from the template at the owner's first wake.
- The host - `trusted: true` and `userSettings: false` on a session request, and `confirm: false` on a `HostTool`.
- [`code://docs/plugins/BOTS.md`](../../../../docs/plugins/BOTS.md) and `packages/bot/README.md` - how a bot wakes, posts and asks, and the entry's grants.

## Verified

- `packages/bot/test/bot-wake.test.ts`: a message starts a back session, a second message is a turn in it, and `{turn}` starts one for each message.
- `packages/bot/test/bot-post.test.ts`: `post_message` ends the main turn, and a back session cannot post into another chat.
- `packages/bot/test/bot-ask.test.ts`: a back session's question is answered from the main chat.
- The gates passed at the tasks' commits: build, typecheck, boundary, schema and vitest.

## Departures from the plan

- The by-hand run in ahpw did not run here. It moved to the final checklist of [the bot chat plan](../20261103-0158-a-bot-chat-follows-its-back-session/plan.md), which fixes the same path, so it runs once, after that fix.

## Left for later

- A request's `instructions` are not kept, so a session started again after a restart is not told them.
- `confirm: false` reaches agent-claude only. `agent-pi` and `agent-cofold` ask from `effects`, and `agent-acp` asks when its server asks.
