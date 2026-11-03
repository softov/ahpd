---
title: A stop ends the back session's turn - implemented
date: 2026-11-03
refs:
  - git://cccdb02b - task 01, `020669b1` applied to upstream main
  - git://5061dc9c - task 02
  - "[code://packages/bot/src/wake.ts](../../../../packages/bot/src/wake.ts)"
---

A client's stop of a bot's turn cancels the running turn of each back session answering it, with the time the bot timed it.
Each back session keeps its link to the main chat.
A message the stop finds on its way to a back session is not sent.

## What was built

- [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts) - `TurnHandle.onStop`, which `cancel` calls.
- [`code://packages/bot/src/plugin.ts`](../../../../packages/bot/src/plugin.ts) - `look` reads the running turn's id, and a stop goes to the wake.
- [`code://packages/bot/src/wake.ts`](../../../../packages/bot/src/wake.ts) - `stopped`, `cancelBack`, the clock per back turn begun, and `delivering`.
- [`code://packages/bot/test/bot-wake.test.ts`](../../../../packages/bot/test/bot-wake.test.ts) - the cancel, the link kept, and the message dropped.
- [`code://packages/bot/test/bot-chat.test.ts`](../../../../packages/bot/test/bot-chat.test.ts) - a stop reaches the handle's holder.

## Verified

- `cccdb02b` changes the same 141 lines as `020669b1`.
- On `a8eff676`'s sources all four cases fail, the wake having no stop at all.
- On task 01's sources the two new cases fail for their own reasons: the link is deleted, and the message is sent.
- Every bot test file passes alone at one worker.
- `pnpm run typecheck` reports no errors.

## Departures from the plan

- Task 02 - a message is counted in `delivering` from the moment the wake takes it, which covers one whose back session is still starting.

## Left for later

- None.
