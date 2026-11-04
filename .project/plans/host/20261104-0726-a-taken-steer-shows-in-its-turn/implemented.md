---
title: A taken steer shows in its turn - implemented
date: 2026-11-04
refs:
  - git://e43d1ae5
  - "[code://packages/sdk/src/sessions/steer.ts](../../../../packages/sdk/src/sessions/steer.ts)"
  - "[code://packages/bot/src/chat.ts](../../../../packages/bot/src/chat.ts)"
  - "[code://packages/agent-claude/src/session/query.ts](../../../../packages/agent-claude/src/session/query.ts)"
  - "[code://packages/agent-claude/src/transcript.ts](../../../../packages/agent-claude/src/transcript.ts)"
  - "[code://packages/sdk/src/host/localturns.ts](../../../../packages/sdk/src/host/localturns.ts)"
---

A message steered into a running turn stays in that turn, where the turn took it in. This works in a bot chat and in a Claude session, live and after a reload. The steer is a `systemNotification` part with the message text.

## What was built

- [`code://packages/sdk/src/sessions/steer.ts`](../../../../packages/sdk/src/sessions/steer.ts) - `steerPart` builds the part, with the steering message's id in `_meta['ahpd.steer']`, and `steerOf` reads the id back.
- [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts) - `steer` adds the part to the open turn, and the read back adds it to a turn whose log line does not hold it.
- [`code://packages/agent-claude/src/session/query.ts`](../../../../packages/agent-claude/src/session/query.ts) - the part shows when the CLI says it started the steer.
- [`code://packages/agent-claude/src/transcript.ts`](../../../../packages/agent-claude/src/transcript.ts) - the reader adds the part for a message the SDK marks `isQueuedCommand`.
- [`code://packages/sdk/src/host/localturns.ts`](../../../../packages/sdk/src/host/localturns.ts) - the fold of a turn the chat never began adds the part before that turn's answer.

## Verified

- `bot-chat.test.ts`, `agent-claude-late-steer.test.ts`, `host-local-turns.test.ts` and `localturns.test.ts` fail without the change and pass with it.
- The gates passed on 2026-11-04: sdk 4209 tests, agent-claude 545, bot 237. CI was green on #219 and #220.
- Softov checked the steer in a bot chat on 2026-11-04.

## Departures from the plan

- Tasks 01 and 02 built the steer as a markdown quote. Task 03 changed it to a `systemNotification` part, because clients drew the quote as the agent's own text.
- A bot turn that ended while a steer was a markdown quote keeps that quote on a reload, and gets no second part.

## Left for later

- The steer part for cofold and pi - see [deferred.md](deferred.md).
