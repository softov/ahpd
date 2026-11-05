---
title: The Session contract follows IAgent
status: done
depends: [task-01-the-host-says-the-clients-action.md]
layer: sdk
refs:
  - "[code://packages/sdk/src/types/session.ts](../../../../packages/sdk/src/types/session.ts) - the contract each backend implements"
  - "[code://packages/sdk/src/host/lifecycle.ts](../../../../packages/sdk/src/host/lifecycle.ts) - `sayStart`, `sendTurn` and `startTurn`, the host's send"
---

## Objective

A backend is handed what VS Code's host hands an agent.
That is a prompt to send, an abort, a model, an agent, steering it may defer or hand back, and a withdrawal.
It says no client's action, keeps no queue, and refuses nothing the host has applied.

## Files

- `UPDATE: packages/sdk/src/types/session.ts` - `sendMessage`, `changeModel`, `changeAgent`, `abort`, `resumeTurn`, `sendSteeringMessage`, `withdrawSteeringMessage`.
- `UPDATE: packages/sdk/src/host/lifecycle.ts` - the host says a start of its own and sends each turn, model and agent first.
- `UPDATE: packages/sdk/src/host/chatactions.ts`, `packages/sdk/src/host/sessionmethods.ts` - config said at once; truncation and fork reconciled.
- `UPDATE: examples/*/agent.ts`, `packages/agent-*/src`, `packages/bot/src/chat.ts`, `packages/sdk/src/sessions/nested.ts` - each backend on the contract.
- `UPDATE: docs/sdk/AGENT.md`, `docs/sdk/AHP.md`, `docs/sdk/CHATS.md` - the contract and the rows that name it.

## Steps

1. Rename `begin` to `sendMessage`, which sends a prompt and says no start (rows 12, 33, E-0001).
2. Rename `cancel` to `abort`, which drops everything the backend holds of the turn (rows 11, 23, 33).
3. Rename `steer` to `sendSteeringMessage`, with its three answers: taken, deferred, handed back (rows 13, 33).
4. Add `withdrawSteeringMessage`, the host's one call at a client's removal (rows 14, 20, 33).
5. Remove `clearSteering`: main has no such member, so nothing goes (row 19).
6. Remove `queue`, `unqueue` and `reorder` in 05, and `ran` in 06 (rows 15, 22).
7. Turn the refusals of D-0024, D-0025 and D-0050 into reconciliations; D-0051 to D-0053 landed in 01.
8. Say a config change at once, its restart a side effect a turn waits on (H1-0013, from 03).
9. Hand a turn's model and agent before its send, logging one the backend does not take (row 9, from 03).

## Validation

- `pnpm run typecheck` reports no errors with every backend on the new contract.
- `packages/sdk/test/echo-origin.test.ts`: the model and agent before the send, each failure, the abort, a host start.
- `packages/sdk/test/session-fixed-key.test.ts`: a config change said at once, a backend's refusal logged.
- `packages/sdk/test/host-chats.test.ts`: a truncation and a fork with no backend point, said and made.

## Resume

- **Done:** steps 1 to 4 and 7 to 9, at the commit that closes this task.
- **Moved:** step 6's removals land with what replaces each, the queue drain in 05, the host's `!` in 06.
- **Interim, until 05:** the host's answer to a false or handed-back steer, and its call of a withdrawal.
- **Interim, until 07 and 08:** backends still say their own starts; the host drops one for a turn it holds.
- **Host starts:** said after the turn's own checks, where VS Code says one before admission.
- **Config:** a key the schema does not declare is the backend's to judge before the echo.
- **Truncation:** the cut stays the host's restart at the backend's end point, since the host starts every backend.
