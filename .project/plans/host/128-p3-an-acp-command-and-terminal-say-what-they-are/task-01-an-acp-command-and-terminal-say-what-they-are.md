---
title: An ACP command and terminal say what they are
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session/queue.ts](../../../../packages/agent-acp/src/session/queue.ts) - `runCommand`, which this task changes"
  - "[code://packages/agent-acp/src/mapping.ts](../../../../packages/agent-acp/src/mapping.ts) - `contentBlocks`, which this task changes"
---

## Objective

An ACP `!` call names its terminal as soon as it opens, and its terminal block says `isPty` as the terminal's state does.
A terminal block for a terminal the server opened says `isPty` as its handle does.

## Files

- `UPDATE: packages/agent-acp/src/session/queue.ts:93-125` - the `!` call's terminal block, early and at the end.
- `UPDATE: packages/agent-acp/src/types.ts:413-424` - `isPty` on `AcpReach`.
- `UPDATE: packages/agent-acp/src/session/turn.ts:343-349` - the reach answers from the session's terminals.
- `UPDATE: packages/agent-acp/src/mapping.ts:373-392` - a server's terminal block asks the reach.
- `UPDATE: packages/agent-acp/test/agent-acp-ports.test.ts` - a command and a server's terminal under a pseudoterminal, through the host.

## Steps

1. Make the `!` call's terminal block from the run's terminal, with `isPty` when the run says it.
2. Put the block onto the held call and into `chat/toolCallContentChanged` when the terminal opens.
3. Make the completion's block from the same run, with its result.
4. Add `isPty` to `AcpReach`, and answer it from the handle the session holds under that name.
5. Make a server's terminal block say `isPty` when the reach answers it.
6. Add the case through the host.

## Validation

- Test that the `!` call names its terminal with `isPty: true` before its completion.
- Test that a server's terminal block says `isPty: true` under a pseudoterminal.
- Test that a client that subscribes during the run, and one after it, reads the calls the replayed actions build.
- Test that the protocol declares every frame.
- Run the case on the session before this change, and see it fail.

## Resume
