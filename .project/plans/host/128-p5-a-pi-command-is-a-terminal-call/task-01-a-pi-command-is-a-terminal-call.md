---
title: A pi command is a terminal call
status: done
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts) - `runCommand`, which this task changes"
  - "[code://packages/agent-pi/test/agent-pi-declared.test.ts](../../../../packages/agent-pi/test/agent-pi-declared.test.ts) - the case through the host"
---

## Objective

A pi `!` call is the reference's terminal call, and it names its terminal as soon as it opens.
It completes with the terminal and the output, and its terminal block says `isPty` as the terminal's state does.

## Files

- `UPDATE: packages/agent-pi/src/session.ts:1115-1160` - the call's start, its ready, its terminal and its completion.
- `UPDATE: packages/agent-pi/test/agent-pi-declared.test.ts` - a command under a pseudoterminal, read by a watching client and by late ones.

## Steps

1. Name the call `terminal`, show it as `Terminal`, and start it with the command as its intention.
2. Make the ready say the command as its line and its input.
3. Put the terminal block onto the held call and into `chat/toolCallContentChanged` when the terminal opens.
4. Complete the call with the terminal block, with its result, and then the output.
5. Add the case through the host.

## Validation

- Test that the call has the name `terminal`.
- Test that the call names its terminal with `isPty: true` before its completion.
- Test that a client that subscribes during the run, and one after it, reads the calls the replayed actions build.
- Test that the protocol declares every frame.
- Run the case on the session before this change, and see it fail.

## Resume

Done 2026-10-27.
The call is a `terminal` call with the command as its intention, its line and its input.
It names its terminal when the terminal opens, and completes with the terminal and the output.
The case fails before this change, and passes after it.
