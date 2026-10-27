---
title: A Claude command shows its terminal
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session/turns.ts](../../../../packages/agent-claude/src/session/turns.ts) - `runCommand`, which this task changes"
  - "[code://packages/sdk/test/host-terminals.test.ts](../../../../packages/sdk/test/host-terminals.test.ts) - the case through the host"
---

## Objective

A Claude `!` call names its terminal as soon as it opens, and its terminal block says `isPty` as the terminal's state does.
A client that subscribes while the command runs, or after it, reads the call a watching client built.

## Files

- `UPDATE: packages/agent-claude/src/session/turns.ts:379-400` - the terminal block, early and at the end.
- `UPDATE: packages/sdk/test/host-terminals.test.ts` - a command under a pseudoterminal, read by a watching client and by late ones.

## Steps

1. Make the terminal block from the run's terminal, with `isPty` when the run says it.
2. Put the block onto the held call and into `chat/toolCallContentChanged` when the terminal opens.
3. Send nothing when the turn has ended before the terminal opened.
4. Make the completion's block from the same run, with its result.
5. Add the case through the host.

## Validation

- Test that `chat/toolCallContentChanged` names the terminal with `isPty: true` before the completion.
- Test that the completion's block says `isPty: true`.
- Test that a client that subscribes during the run, and one after it, reads the calls the replayed actions build.
- Test that the protocol declares every frame.
- Run the case on the session before this change, and see it fail.

## Resume
