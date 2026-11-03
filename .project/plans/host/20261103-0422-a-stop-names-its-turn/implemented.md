---
title: A stop names its turn - implemented
date: 2026-11-03
refs:
  - git://0b7e8ff0 - the change
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts)"
---

A client's stop stops the turn its `turnId` names, and nothing else.
A stop that names no turn goes to every client of the chat as the client sent it, and reaches no backend.
A client's tool result goes to every client as the client sent it.

## What was built

- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - a stop reaches a backend only when its `turnId` is the held running turn's.
- The same file says a client's tool result as sent, with no turn filled in.
- [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts) - when the host calls `cancel`.
- [`code://packages/sdk/test/echo-origin.test.ts`](../../../../packages/sdk/test/echo-origin.test.ts) - a stop with an empty or missing `turnId` is said as sent, and the turn runs to its end.
- [`code://packages/sdk/test/host-tools.test.ts`](../../../../packages/sdk/test/host-tools.test.ts) - a client's result with no `turnId` is said as sent.
- `agent-acp-turn.test.ts` and `agent-cofold-turn.test.ts` - a stop naming no turn leaves the turn for the stop that names it.
- `notes.test.ts` and `subagent-chat.test.ts` - a stop of a running turn names it, as a client's does.
- The client tool cases of agent-acp and agent-cofold send the turn their call is in.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md), [`code://docs/sdk/AGENT.md`](../../../../docs/sdk/AGENT.md) and [`code://.project/specs/sessions-and-chats.md`](../../../specs/sessions-and-chats.md) - how a stop is answered.

## Verified

- On `cde4dd6c`'s `chatactions.ts` five cases fail: two stops in `echo-origin`, the result in `host-tools`, and the ACP and cofold stops.
- Each fails for the stop carried out or the turn filled in, and each passes with `0b7e8ff0`.
- With the change, each touched file passes alone at one worker, as do `ahp-test-cases`, `host-catalogue` and `session-wake`.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- Task 01 - `notes.test.ts` and a worker case of `subagent-chat.test.ts` stopped a running turn with `turnId: ''`, and now name the running turn.

## Left for later

- None.
