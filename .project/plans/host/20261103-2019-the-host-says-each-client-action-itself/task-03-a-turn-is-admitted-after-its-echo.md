---
title: A turn is admitted after its echo
status: todo
depends: [task-01-the-host-says-the-clients-action.md]
layer: host
refs:
  - "[code://packages/sdk/src/host/lifecycle.ts#L1315-L1540](../../../../packages/sdk/src/host/lifecycle.ts#L1315-L1540) - `beginOrRun`: the policy check, the machine's catch-up, the refusals"
  - "[code://packages/sdk/src/host/chatactions.ts#L854-L1260](../../../../packages/sdk/src/host/chatactions.ts#L854-L1260) - a config change that restarts the backend"
---

## Objective

A client's start is said, then admitted.
A refusal by a policy, a read-only chat, an ended agent or an archived session ends the turn with chat/error.
The machine's catch-up, a restart and the turn's model and agent are its preparation, checked for a stop before the prompt goes out.

## Files

- `UPDATE: packages/sdk/src/host/lifecycle.ts` - admission after the echo; preparation with stop checks; the start owed to a backend goes.
- `UPDATE: packages/sdk/src/host/chatactions.ts` - the refusals that VS Code decides after the echo become admission.
- `UPDATE: packages/sdk/src/host/machines.ts` - the catch-up runs in the turn's preparation.

## Steps

1. Say the start before the policy check runs (rows 1, 8).
2. End a turn the policy refuses with chat/error on it (row 8, H1-0009).
3. End a turn on a read-only chat, an ended agent or an archived session with chat/error too (row 8).
4. Run the machine's catch-up and a config restart before the send (H1-0010, H1-0013).
5. Apply the turn's model and agent before the send, logging a refusal (row 9).
6. Check for a stop after each step of preparation (row 10, H1-0045).

## Validation

- Run `packages/sdk/test/policy-checks.test.ts`: the host says a refused turn, then ends it with chat/error.
- Add a case for a stop during a machine's catch-up: the host sends the backend nothing.
- Add a case for a refused model: the backend runs the turn on the model it has.

## Resume

