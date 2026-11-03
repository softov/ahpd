---
title: A stop ends the back session's turn - implemented
date: 2026-11-03
refs:
  - git://020669b1 - task 01's change, which upstream merged
  - git://a4fac2f4 - task 02
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

- Task 01's two cases pass on `cde4dd6c`, which carries its change through `#195`.
- On `cde4dd6c`'s sources the two new cases fail: the stop deletes the link, and the message is sent.
- Every bot test file passes alone at one worker.
- `pnpm run typecheck` reports no errors.

## Departures from the plan

- Task 02 - a message is counted in `delivering` from the moment the wake takes it, which covers one whose back session is still starting.

## Left for later

- None.
