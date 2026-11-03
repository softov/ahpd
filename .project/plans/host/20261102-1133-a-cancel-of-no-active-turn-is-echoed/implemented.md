---
title: A stop of no running turn is echoed - implemented
date: 2026-11-02
refs:
  - git://b12462af - the change
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts)"
---

A client's stop that names no running turn of its chat stops nothing, as VS Code's host takes it.
It goes to every client of the chat as the client's own action.
That is a chat with no turn running, a turn other than the running one, and a sleeping session's chat, which is not woken.
A stop of the running turn stops it, as before.

## What was built

- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - a stop on a session asleep is said back with nothing woken.
- The same file says back a stop that names no running turn, before the lead and worker paths.
- [`code://packages/sdk/test/host-catalogue.test.ts`](../../../../packages/sdk/test/host-catalogue.test.ts), `session-wake.test.ts` and `subagent-chat.test.ts` - each stop that stops nothing is said to every client, and no backend is asked.
- [`code://packages/sdk/test/ahp-test-cases.test.ts`](../../../../packages/sdk/test/ahp-test-cases.test.ts) - the oracle allows no refusal of a stop.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) and [`code://.project/specs/sessions-and-chats.md`](../../../specs/sessions-and-chats.md) - how a stop is answered.

## Verified

- On `6e6d1ca8`'s `chatactions.ts`, four cases fail: three for the refusal, and the running worker's for the stop it carried out.
- With `b12462af` the four files pass, 759 of 759, all the protocol's cases among them.
- The 64 unit files that send or read a stop pass with the change, 1096 tests.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- Task 01 - two worker cases named a turn the worker was not running, and now name its running turn.

## Left for later

- None.
