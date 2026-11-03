---
title: The link stays, and pending sends go
status: todo
depends: [task-01-a-stop-cancels-the-back-turn.md]
layer: bot
refs:
  - "[code://packages/bot/src/wake.ts](../../../../packages/bot/src/wake.ts) - `stopped` and `woken`"
---

## Objective

A stop keeps each back session's link to the main chat.
A message for the stopped turn still on its way to a back session is not sent.
One whose send was under way has its back turn cancelled.

## Files

- `UPDATE: packages/bot/src/wake.ts` - `stopped` keeps `answering`, and marks the deliveries in flight for the stopped turn; `woken` drops a marked one.
- `UPDATE: packages/bot/test/bot-wake.test.ts` - the link stays after a stop, and a message the stop finds on its way is not sent.

## Steps

1. Keep `answering` in `stopped`.
2. Count the deliveries in flight for each main turn, and mark them at its stop.
3. Drop a marked delivery before its send, and cancel the back turn of one marked during its send.
4. Add the cases.

## Validation

- The new cases fail on `a8eff676` and pass after.
- The bot's test files pass, one at a time.

## Resume
