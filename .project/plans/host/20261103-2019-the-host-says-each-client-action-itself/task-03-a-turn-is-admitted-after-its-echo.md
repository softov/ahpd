---
title: A turn is admitted after its echo
status: done
depends: [task-01-the-host-says-the-clients-action.md]
layer: host
refs:
  - "[code://packages/sdk/src/host/lifecycle.ts](../../../../packages/sdk/src/host/lifecycle.ts) - `beginOrRun` and `beginTurn`: the policy check, the machine's catch-up, the stop checks"
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - the start said, its admission, a restart as its preparation"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `restarting` and the stopped turns kept per chat"
---

## Objective

A client's start is said, then admitted.
A refusal by a policy, a read-only chat, an ended agent or an archived session ends the turn with chat/error.
The machine's catch-up, a restart and the chats it attaches are its preparation, checked for a stop before the prompt goes out.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts` - the start said first; admission and preparation end it with chat/error; a restart is its preparation.
- `UPDATE: packages/sdk/src/host/lifecycle.ts` - `beginTurn` takes a throw as a failed send; the stop checked before each step of preparation.
- `UPDATE: packages/sdk/src/host.ts`, `packages/sdk/src/host/context.ts` - `cancelledTurns` per chat; `restarting` settles with a failed start's words.
- `UPDATE: packages/sdk/src/types/session.ts` - `ended` ends a new turn in an error.
- `UPDATE: docs/sdk/AHP.md`, `docs/sdk/CHATS.md`, `docs/sdk/POLICY.md` - a start said, then admitted or ended in an error.

## Steps

1. Say the start before the policy check runs (rows 1, 8).
2. End a turn the policy refuses with chat/error on it (row 8, H1-0009).
3. End a turn on a read-only chat, an ended agent or an archived session too (row 8, H1-0011, H1-0018).
4. Run the machine's catch-up and a config restart before the send (H1-0010, H1-0013).
5. Apply the turn's model and agent before the send, logging a refusal (row 9): moved to task 04.
6. Check for a stop after each step of preparation (row 10, H1-0045).

## Validation

- `packages/sdk/test/policy-checks.test.ts`: the host says a refused turn, then ends it with chat/error.
- `packages/sdk/test/echo-origin.test.ts`: a stop during a machine's catch-up sends the backend nothing.
- `packages/sdk/test/session-fixed-key.test.ts`: a turn during a restart is said at once, and a stop keeps it unsent.

## Resume

- **Done:** steps 1 to 4 and 6, at the commit that closes this task.
- **Moved to 04:** step 5, which needs the `changeModel` and `changeAgent` calls 04 gives the contract.
- **Moved to 04:** H1-0013's config half, a config said at once, with D-0050.
- **Admission during a restart:** runs once the session is up, since nothing holds the session meanwhile.
- **errorType:** `rejected` for ahpd's own refusals, VS Code's turn end for an admission rejection.
- **errorType:** `sendFailed` for a failed preparation, as VS Code's send names one.
- **Attachments:** resolved after the echo, as VS Code's send resolves them.
