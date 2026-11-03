---
title: A reloaded chat shows the steer in its turn - implemented
date: 2026-11-03
refs:
  - git://b553da30 - the change
  - "[code://packages/bot/src/chat.ts](../../../../packages/bot/src/chat.ts)"
---

A bot chat read back after a restart shows the turn a steer went into, as the live chat does.

## What was built

- [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts) - `logAt` reads a `steering` line for its mark, and reads no turn from it.
- [`code://packages/bot/test/bot-chat.test.ts`](../../../../packages/bot/test/bot-chat.test.ts) - the live steer's chat read back, and a line written before the live chat changed.
- [`code://docs/sdk/CHATS.md`](../../../../docs/sdk/CHATS.md) - what a chat read back shows of a steer.

## Verified

- On `a8eff676`'s sources both cases fail: the chat read back holds a second turn with the steered message.
- Every bot test file passes alone at one worker.
- `pnpm run typecheck` reports no errors.

## Departures from the plan

- None.

## Left for later

- None.
