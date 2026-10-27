---
title: A cofold command shows its terminal
status: done
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/turns.ts](../../../../packages/agent-cofold/src/turns.ts) - `runCommand`, which this task changes"
  - "[code://packages/agent-cofold/test/agent-cofold-approval.test.ts](../../../../packages/agent-cofold/test/agent-cofold-approval.test.ts) - the case through the host"
---

## Objective

A cofold `!` call is the reference's terminal call, and the session holds it as a watching client does.
It names its terminal as soon as it opens, and its terminal block says `isPty` as the terminal's state does.

## Files

- `UPDATE: packages/agent-cofold/src/turns.ts:436-510` - the call's start, its ready, its terminal and its completion.
- `UPDATE: packages/agent-cofold/test/agent-cofold-approval.test.ts` - a command under a pseudoterminal, read by a watching client and by late ones.

## Steps

1. Start the call with the command as its intention.
2. Make the ready's fields once, with the command as the line and the input.
3. Put them onto the held call with status `running`, and send them.
4. Put the terminal block onto the held call and into `chat/toolCallContentChanged` when the terminal opens.
5. Make the completion's block from the same run, with its result.
6. Add the case through the host.

## Validation

- Test that the ready says the command as its line.
- Test that the call names its terminal with `isPty: true` before its completion.
- Test that a client that subscribes during the run, and one after it, reads the calls the replayed actions build.
- Test that the protocol declares every frame.
- Run the case on the session before this change, and see it fail.

## Resume

Done 2026-10-27.
The call starts with the command as its intention, and its ready goes onto the held call, which runs.
The terminal goes onto the call and into `chat/toolCallContentChanged` when it opens.
The case is in the turn suite, beside the other `!` command case, and fails before this change.
