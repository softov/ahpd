---
title: A bot session is made where the bot is offered
created: 2026-11-14
refs:
  - git://9b15ce74a - the commit of ahpd the facts were checked at
  - "[code://packages/bot/src/chat.ts#L1405-L1425](../../packages/bot/src/chat.ts#L1405-L1425) - `placeSession`, which moves a talk to the bot's folder whatever folder the client sent"
  - "[code://packages/bot/src/wake.ts](../../packages/bot/src/wake.ts) - `backOf`, which starts the Back chat on the bot's `preset` or `provider`"
  - "[code://.project/plans/plugin/20261114-1455-a-bot-talk-needs-no-grant/plan.md](../plans/plugin/20261114-1455-a-bot-talk-needs-no-grant/plan.md) - the trust of the bot's folder, a plan of its own"
---

# A bot session is made where the bot is offered

Softov's goal: a person starts a talk with a bot from any client, and the talk runs on the bot's real agent.
The form offers only what applies to a bot.

## What Softov saw on 2026-11-14

- VS Code cannot make a bot session. Its form needs a model, and the bot chat agent has none.
- The new session form in ahpw offers a folder, isolation and a branch for a bot. The talk runs in the bot's folder whatever folder is picked.
- ahpw offers the bot chat agent and the bots when the bot plugin cannot open a talk, and the create then fails.
- The Back chat shows the bot chat agent as its provider, not the agent the bot runs on.

## What ahpd has now

- A talk is a session of the `bot-chat` agent, made with `createSession` and the bot's slug in its config.
- `placeSession` moves the talk to the bot's folder, on the bot's computer, with no user settings. The folder the client sent is not used.
- The Back chat is a chat of the talk's session, started on the bot's `preset` or `provider`. A bot that names neither runs on the host's default agent.

## The change, to discuss

- A bot is offered as a bot, not as an agent with a folder picker. A client draws a form that has the bot and the message, and nothing that the talk does not use.
- A client that needs a model for an agent can make a talk. The bot chat agent answers a model, or a client is told it needs none.
- The bot is not offered where its plugin cannot open a talk.
- The Back chat names the agent the bot runs on as its provider.

## Questions for a plan

- Where is a bot offered: in the agent picker, in a list of its own, or in both?
- What model does the bot chat agent answer: the bot's own model, or none with a flag that says so?
- Which of these are ahpd changes, and which are changes in ahpw and in what VS Code is sent?
