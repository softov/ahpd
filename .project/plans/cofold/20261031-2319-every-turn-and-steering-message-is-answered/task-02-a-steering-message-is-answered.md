---
title: A steering message is answered, held and taken out
status: todo
depends: []
layer: cofold
refs:
  - "[code://packages/agent-cofold/src/session.ts#L361-L386](../../../../packages/agent-cofold/src/session.ts#L361-L386) - `steer`"
  - "[code://packages/agent-pi/src/session.ts#L1370-L1418](../../../../packages/agent-pi/src/session.ts#L1370-L1418) - pi's steer"
  - "https://github.com/microsoft/agent-host-protocol/blob/main/docs/specification/chat-channel.md#steering-messages - consumption and retention"
---

## Objective

A steering message is said back as the chat's steering message inside the dispatch, which answers the client that sent it, and taken out once the run has read it into its transcript. One the run never took in becomes a turn of its own once the chat is idle.

## Files

- `UPDATE: packages/agent-cofold/src/context.ts` - the chat's steering message, and the ones the run never took in.
- `UPDATE: packages/agent-cofold/src/session.ts` - `steer` says and holds the message, and takes it out when cofold's submit settles; `chatState` carries `steeringMessage`.
- `UPDATE: packages/agent-cofold/src/turns.ts` - `startNext` runs a steering message the run never took in before the queue, named by `queuedMessageId`.
- `UPDATE: packages/agent-cofold/test/agent-cofold-turn.test.ts` - a steer answered with its origin, held, and taken out once read; a steer the run never took in runs as a turn of its own.
- `UPDATE: docs/sdk/CHATS.md`, `docs/sdk/AHP.md` - cofold's steering.

## Steps

1. Write the cases and run them on `47d14247` to see nothing said.
2. Say, hold and take out; run the untaken one as a turn.

## Validation

- The new cases fail on `47d14247` and pass after the change.
- The agent-cofold suite passes; `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Resume

Not started.
