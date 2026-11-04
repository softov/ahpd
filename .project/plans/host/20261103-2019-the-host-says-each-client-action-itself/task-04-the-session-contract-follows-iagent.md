---
title: The Session contract follows IAgent
status: todo
depends: [task-01-the-host-says-the-clients-action.md]
layer: sdk
refs:
  - "[code://packages/sdk/src/types/session.ts#L587-L972](../../../../packages/sdk/src/types/session.ts#L587-L972) - the contract each backend implements"
---

## Objective

A backend is handed what VS Code's host hands an agent.
That is a prompt to send, an abort, a model, an agent, steering it may defer or hand back, and a withdrawal.
It says no client's action, keeps no queue, and refuses nothing the host has applied.

## Files

- `UPDATE: packages/sdk/src/types/session.ts` - `begin` becomes `sendMessage`, which says no start; `cancel` becomes `abort`; `steer` becomes `sendSteeringMessage`, answering true, false or a promise of false; `withdraw` becomes `withdrawSteeringMessage`.
- `UPDATE: packages/sdk/src/types/session.ts` - `queue`, `unqueue`, `reorder`, `clearSteering` and `ran` go; config, toggles, MCP requests, fork and truncation stop answering a refusal; a truncation is `truncateChat`.
- `UPDATE: docs/sdk/AGENT.md`, `docs/sdk/AHP.md`, `docs/sdk/CHATS.md` - the contract and the rows that name it.

## Steps

1. Rename `begin` to `sendMessage`, which sends a prompt and says no start (rows 12, 33, E-0001).
2. Rename `cancel` to `abort`, which drops everything the backend holds of the turn (rows 11, 23, 33).
3. Rename `steer` to `sendSteeringMessage`, with its three answers: taken, deferred, handed back (rows 13, 33).
4. Rename `withdraw` to `withdrawSteeringMessage`, the host's one call at a client's removal (rows 14, 20, 33).
5. Remove `clearSteering`, since the host removes pending steering itself (row 19).
6. Remove `queue`, `unqueue`, `reorder` and `ran` (rows 15, 22).
7. Turn the refusals of D-0024, D-0025 and D-0050 into reconciliations; D-0051 to D-0053 landed in 01.
8. Say a config change at once, its restart a side effect a turn waits on (H1-0013, from 03).
9. Hand a turn's model and agent before its send, logging one the backend does not take (row 9, from 03).

## Validation

- `pnpm run typecheck` reports no errors with every backend on the new contract.
- The cases of each backend move with tasks 07 to 09.

## Resume

