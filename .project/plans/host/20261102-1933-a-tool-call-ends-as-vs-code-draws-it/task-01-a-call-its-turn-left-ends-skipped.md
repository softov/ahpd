---
title: A call its turn left ends skipped
status: done
depends: []
layer: bot, agent-pi
refs:
  - "[code://packages/bot/src/chat.ts#L694-L713](../../../../packages/bot/src/chat.ts#L694-L713) - `finish`"
  - "[code://packages/agent-pi/src/session.ts#L360-L387](../../../../packages/agent-pi/src/session.ts#L360-L387) - `releasePending`"
---

## Objective

A bot's call completes as worked only when the back session answered its turn.
pi says nothing of a waiting call a stop leaves.
Each such call ends cancelled, `skipped`, in the backend's record as in every client's state.

## Files

- `UPDATE: packages/bot/src/chat.ts:694-713` - `finish` takes whether the back session answered.
- `UPDATE: packages/agent-pi/src/session.ts:360-387` - `releasePending` says no confirmation.
- `UPDATE: packages/bot/test/bot-chat.test.ts` - a stopped turn's call, and the steered turn's call.
- `UPDATE: packages/agent-pi/test/agent-pi-asking.test.ts` - a stop's waiting call.

## Steps

1. Complete the bot's calls only from `reply`.
2. Keep what the reducer keeps of each other call, cancelled and `skipped`.
3. Remove pi's confirmation at a stop, and mark its call as the reducer does.
4. Add a case for a bot turn stopped while its call waits.
5. Change the cases that read the old ending.

## Validation

- The new and changed cases fail on `89ebe4d5` and pass after.
- The bot and agent-pi test files pass.
- `pnpm run typecheck` is clean.

## Resume

Built 2026-11-02.

- A stop was already masked: the host ends the turn on a client's stop.
- It then drops a backend's result for a call it no longer holds running.
- So the new case ends the turn with a notice, which the bot ends itself.
- `bot-chat.test.ts`'s subagent case moved with the behavior: the steered turn's call read as worked.
- `agent-pi-asking.test.ts` moved too: its stop read a denial for the waiting call.
- On `89ebe4d5`'s sources the three cases fail: a call read as worked, and a denial was said.
