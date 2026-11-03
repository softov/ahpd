---
title: A `!` command is the host's
status: todo
depends: [task-05-the-host-owns-the-queue.md]
layer: host
refs:
  - "[code://packages/sdk/src/host/lifecycle.ts#L1315-L1540](../../../../packages/sdk/src/host/lifecycle.ts#L1315-L1540) - a command handed to a backend's `ran`, refused without it"
---

## Objective

A `!` command is run by the host in its own terminal, for every backend, sent as a turn or queued.
It runs when its turn is admitted, whatever turn another client started before it.
Its call completes with the exit or the failure, and its turn completes.

## Files

- `UPDATE: packages/sdk/src/host/lifecycle.ts` - the host runs the command as the turn's local command, under that name (row 33).
- `UPDATE: packages/sdk/src/host/terminals.ts` - the terminal tool call and the turn's end.
- `UPDATE: packages/agent-acp/src/session/queue.ts`, `packages/agent-cofold/src/turns.ts`, `packages/agent-pi/src/session.ts` - each backend's own command runner goes.

## Steps

1. Run a `!` turn in a host terminal before admission, for every backend (row 22).
2. Run a `!` turn at once while another turn runs (row 22; F-0008, F-0087, F-0138).
3. Run a queued `!` message once the drain admits it (rows 16, 22; E-0007, F-0007, F-0086).
4. Complete a non-zero exit with `success: false` and no `error` (row 34; F-0010, F-0089, F-0141).
5. Complete a command that could not run with its error (row 34; F-0142).
6. Complete the turn when the command ends, and hold it complete (row 34; F-0011).

## Validation

- Add to `packages/sdk/test/host-terminals.test.ts`: the host runs a `!` turn on the bot and the nested proxy.
- Add a case for a queued `!` message on an idle chat.
- Check in it that the host says the client's set, then the drain's start, then runs the command.
- Add a case for a `!` turn while another turn runs: its terminal opens before that turn ends.
- Add a case for a command exiting 3: the call has no `error`, and the held turn is complete.

## Resume

