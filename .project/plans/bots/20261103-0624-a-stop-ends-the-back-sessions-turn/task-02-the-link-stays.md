---
title: The link stays, and pending sends go
status: done
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

- The new cases fail on `cde4dd6c` and pass after.
- The bot's test files pass, one at a time.

## Resume

Built 2026-11-03 in `a4fac2f4`.

- `cancelBack` is the cancel of one back session, which the stop and a send a stop came during both call.
- The deliveries are counted from the moment a message is handed to the wake, so one whose back session is still starting is covered.
- The harness holds every start on a promise a case releases, which is how a case acts while a message is on its way.
- Both cases fail on `cde4dd6c`'s sources, where the stop deletes the link and the message is sent.
