---
title: Every turn and steering message a cofold session is handed is answered - implemented
date: 2026-10-31
refs:
  - "[code://packages/agent-cofold/src/turns.ts](../../../../packages/agent-cofold/src/turns.ts) - `beginTurn`, `startNext`"
  - "[code://packages/agent-cofold/src/session.ts](../../../../packages/agent-cofold/src/session.ts) - `steer`, `chatState`"
  - "[code://packages/agent-cofold/src/context.ts](../../../../packages/agent-cofold/src/context.ts) - `steering`, `untaken`"
---

A turn handed while a cofold session reads the conversation it resumes, forks or rewinds, which finds a turn running once the read is done, is refused to the client that sent it with "A turn is running in this chat".
A steering message is said back as the chat's steering message inside the dispatch, held as `steeringMessage`, taken out once cofold has written it into the run's transcript, and run as a turn of its own, named by `queuedMessageId`, when the run never read it.

## What was built

- [`code://packages/agent-cofold/src/turns.ts`](../../../../packages/agent-cofold/src/turns.ts) - `beginTurn` takes the client's `handed` while its dispatch is applied and refuses through it when the turn finds another active after the wait; `startNext` runs a steering message the run never took in before the queue.
- [`code://packages/agent-cofold/src/session.ts`](../../../../packages/agent-cofold/src/session.ts) - `steer` says and holds the message, takes it out when cofold's submit settles, and keeps it in `untaken` when the submit is rejected, asking for the next turn unless a client stopped the run; `chatState` carries `steeringMessage`.
- [`code://packages/agent-cofold/src/context.ts`](../../../../packages/agent-cofold/src/context.ts) - `steering` and `untaken`.
- Docs: [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) (the `chat/turnStarted` row), [`code://docs/sdk/CHATS.md`](../../../../docs/sdk/CHATS.md) (cofold's steering), [`code://packages/agent-cofold/README.md`](../../../../packages/agent-cofold/README.md) ("Messages sent while a turn runs").
- Two cases in `agent-cofold-store.test.ts` (a second turn handed during a resume's read; a turn handed while a paused run reopens) and two in `agent-cofold-turn.test.ts` (a steer answered, held and taken out; a steer the run never read run as a turn of its own).

## Verified

- On `47d14247` each case fails for the reason it names: the second turn is refused by nothing (`[]`), the turn during the reopen is never answered, and neither steering message is ever answered with the client's origin.
- After the change, agent-cofold with host-turn, echo-origin, host-input, ahp-test-cases and nested-proxy pass: 23 files, 1038 tests.
- The round's full run at two workers: `test:unit` 7349 pass with one 5 s timeout in `vault-port.test.ts`, whose file passes whole alone; `test:processes` 695 pass, none failing. No test daemon was left running.
- `pnpm run typecheck` and `pnpm run boundary` pass.

## Departures from the plan

- none.

## Left for later

- none.
