---
title: The bot waits on every answer and hands on the message whole, implemented
plan: plan.md
built: 2026-11-02
commits:
  - git://d8e21421 - the plan
  - git://8e3ae536 - tasks 01 and 02
---

## What changed

- [`code://packages/bot/src/plugin.ts`](../../../../packages/bot/src/plugin.ts) - `dispatcher` settles a dispatch on the host's answer alone; `ECHO_MS` and the silence notice are gone.
- [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts) - a message, held or begun, keeps its model and attachments, and `onMessage` is told them with the agent.
- [`code://packages/bot/src/wake.ts`](../../../../packages/bot/src/wake.ts) - the back session's turn and steer carry the model, the agent and the attachments beside the person's words.

## Verified

- On c3c8c3e4's sources the four new cases fail, and all pass with the change.
  `bot-dispatcher.test.ts` fails there at its import, since `dispatcher` is not exported, and its timer took a dispatch as taken after 10 seconds.
- `bot-chat.test.ts` and `bot-wake.test.ts` each hold one new case.
- `pnpm run typecheck` exits 0.

## Each label against VS Code's host (main 8fb60541)

- B9, B11: the bot is this repository's own client and backend, and no VS Code client is one; the protocol's text decides both.

## Departures from the plan

- None.
