---
title: slow runs and fail ends in an error
status: done
depends: [task-01-the-demo-host-serves-every-subject.md]
layer: "examples"
refs:
  - "[code://examples/notes/agent.ts#L620](../../../../examples/notes/agent.ts#L620) - `begin`, which the wrap goes in front of"
  - "[code://examples/notes/agent.ts#L678](../../../../examples/notes/agent.ts#L678) - `cancel`, which stops a turn"
---

## Objective

A message `slow` makes a turn that runs for a minute, and a message `fail` makes a turn that ends in an error.
So a client sees a running session and a session in error with no model.

## Files

- `UPDATE: examples/demo/agent.ts` - wrap each session's `begin` and `cancel` for `slow` and `fail`.
- `UPDATE: examples/demo/README.md` - the two commands.
- `UPDATE: packages/sdk/test/demo.test.ts` - the cases in *Validation*.

## Steps

1. Wrap `create` so each session's `begin` reads the message first.
2. For `slow`, start the turn, and stream one markdown line every second for 60 seconds.
3. End the `slow` turn with `chat/turnComplete` after the last line.
4. Make `cancel` stop a `slow` turn that is running, and clear its timer.
5. For `fail`, start the turn, and end it with the protocol's error for a turn.
6. Pass every other message to the `notes` session as it is.
7. Add `slow` and `fail` to the commands the `probe` offers.

## Validation

- `packages/sdk/test/demo.test.ts`: `slow` leaves a turn active, and the session is running.
- `packages/sdk/test/demo.test.ts`: a cancel stops `slow`, and no line comes after it.
- `packages/sdk/test/demo.test.ts`: `fail` ends its turn with an error, and the session shows the error.
- `packages/sdk/test/demo.test.ts`: `read` still asks which note, as `notes` does.
- The repository's typecheck and tests pass.

## Resume
