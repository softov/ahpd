---
title: A steer keeps the back turn - implemented
date: 2026-11-04
refs:
  - git://7bea7af3
  - "[code://packages/bot/src/chat.ts](../../../../packages/bot/src/chat.ts)"
  - "[code://packages/bot/src/wake.ts](../../../../packages/bot/src/wake.ts)"
---

A message that a person steers into a bot's open main turn reaches the back turn as a steer. A refused steer does not end the main turn, and the back turn's posts still land in it.

## What was built

- [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts) - `ChatMessage` has `steered`, and `steer` sets it.
- [`code://packages/bot/src/wake.ts`](../../../../packages/bot/src/wake.ts) - a message reaches the back session as `steering` when it was steered, and as `queued` when it began a main turn. A refused steer keeps the binding.

## Verified

- `bot-wake.test.ts` has a case for a steer and a case for a refused steer.
- #215 merged with CI green.
- Softov ran `bot-steer-checks.md` on 2026-11-04, and it passed.

## Departures from the plan

- None.
