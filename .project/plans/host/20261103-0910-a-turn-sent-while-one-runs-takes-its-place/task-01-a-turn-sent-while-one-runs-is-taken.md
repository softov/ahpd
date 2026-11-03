---
title: A turn sent while one runs is taken
status: todo
depends: []
layer: host and backends
refs:
  - "[code://packages/sdk/src/host/lifecycle.ts#L1356-L1392](../../../../packages/sdk/src/host/lifecycle.ts#L1356-L1392) - `beginOrRun`'s `run`"
  - "[code://packages/sdk/src/host/chatactions.ts#L396-L419](../../../../packages/sdk/src/host/chatactions.ts#L396-L419) - the wait for a stopped turn's end"
  - "[code://packages/agent-claude/src/session/turns.ts#L619-L633](../../../../packages/agent-claude/src/session/turns.ts#L619-L633) - Claude's `begin`"
  - "[code://packages/agent-cofold/src/turns.ts#L527-L566](../../../../packages/agent-cofold/src/turns.ts#L527-L566) - cofold's `beginTurn`"
---

## Objective

A start a client sends while a turn runs is handed to the backend and said at once, in the running turn's place.
Each backend runs the turns it was handed in order, once the work in front of each is done.
A stop of the turn that took the place stops the work in flight and drops the turns waiting.
An action sent after a stop is applied at once.

## Files

- `UPDATE: packages/sdk/src/host/lifecycle.ts` - `run` hands every start to its backend.
- `UPDATE: packages/sdk/src/host/chatactions.ts` - the stopped-turn wait goes, and steering goes to a backend only while the chat holds a running turn.
- `UPDATE: packages/sdk/src/host.ts`, `packages/sdk/src/host/context.ts` - `stopping` and `letGo` go.
- `UPDATE: packages/sdk/src/types/session.ts` - `begin`'s contract for a turn handed while one runs.
- `UPDATE: packages/agent-claude/src/session/turns.ts`, `query.ts`, `context.ts` - the turns handed while one runs, said at once and sent once the CLI owes nothing in front of them; a steering message a client takes back is withdrawn.
- `UPDATE: packages/agent-pi/src/session.ts` - the turns said while pi runs another, and the queue's head said at once while a stopped turn winds down.
- `UPDATE: packages/agent-cofold/src/turns.ts`, `session.ts`, `runs.ts`, `context.ts`, `README.md` - the same, and a steer a client takes back while the run holds it is dropped when the run gives it back.
- `UPDATE: packages/agent-acp/src/session/queue.ts`, `turn.ts`, `context.ts`, `session.ts` - the same.
- `UPDATE: packages/bot/src/chat.ts` - the turns said while another is open.
- `UPDATE: examples/echo/agent.ts`, `examples/notes/agent.ts` - the same, and a run that ends only its own turn.
- `UPDATE: docs/sdk/AHP.md`, `docs/sdk/TERMINALS.md` - the `chat/turnStarted` and `chat/turnCancelled` rows, and a command sent as a turn.
- `UPDATE:` the cases in sdk host-turn and host-terminals, agent-pi, agent-cofold store, turn and plugin, agent-acp turn, and the bot chat and dispatcher files.

## Steps

1. Remove the host's refusal of a start while a turn runs.
2. Say a turn handed while one runs at once, in each backend.
3. Run each handed turn once the work in front of it ends.
4. Keep a replaced turn out of every history.
5. End a handed turn on its stop, drop the turns waiting, and stop the work in flight.
6. Remove the host's wait for a stopped turn's end.
7. Say the queue's head at once while a stopped run winds down.
8. Hand steering to a backend only while the chat holds a running turn.
9. Withdraw a steering message a client takes back while a run holds it.
10. Change the cases that named the refusal, and add cases for each step.

## Validation

- The changed and new cases fail on `feb72387`'s sources and pass after.
- Each touched package's test files pass, one file at a time.
- `pnpm run typecheck` and `pnpm run boundary` are clean.
