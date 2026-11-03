---
title: A stop stops the turn it names
status: doing
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L1380-L1427](../../../../packages/sdk/src/host/chatactions.ts#L1380-L1427) - a stop on a chat"
  - "[code://packages/sdk/src/host/chatactions.ts#L2127-L2179](../../../../packages/sdk/src/host/chatactions.ts#L2127-L2179) - a client's tool result"
---

## Objective

A stop reaches a backend only when its `turnId` names the turn the chat runs.
A stop naming no turn, and a client's tool result, go to every client of the chat as the client sent them.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts:1380-1427` - a stop naming no turn is said as sent, and nothing is stopped.
- `UPDATE: packages/sdk/src/host/chatactions.ts:642-654` - `stopped` says the client's stop with its own `turnId`.
- `UPDATE: packages/sdk/src/host/chatactions.ts:2127-2179` - a client's tool result is said as sent; the comment on the owed completion goes.
- `UPDATE: packages/sdk/src/types/session.ts:636-646` - `cancel` is called for a stop that names the running turn.
- `UPDATE: packages/sdk/test/echo-origin.test.ts:205-224` - a stop naming no turn is said as sent and stops nothing.
- `UPDATE: packages/sdk/test/host-tools.test.ts` - a client's result naming no turn is said as sent.
- `UPDATE: packages/agent-acp/test/agent-acp-turn.test.ts:752-772` - a stop naming no turn stops nothing.
- `UPDATE: packages/agent-cofold/test/agent-cofold-turn.test.ts:416-436` - the same for cofold.
- `UPDATE: packages/agent-acp/test/agent-acp-client-tool.test.ts:329-337` - a client's result names its turn.
- `UPDATE: packages/agent-cofold/test/agent-cofold-client-tool.test.ts` - a client's result names its turn.
- `UPDATE: docs/sdk/AHP.md:276` - the `chat/turnCancelled` row.
- `UPDATE: docs/sdk/AGENT.md:265-267` - when the host calls `cancel`.
- `UPDATE: .project/specs/sessions-and-chats.md:87-101` - a stop that names no turn.

## Steps

1. Say a stop whose `turnId` is not the running turn's as sent, a missing one included.
2. Say the stop of the running turn with the client's own `turnId`.
3. Say a client's tool result as sent.
4. Change the cases that sent `turnId: ''` to show that the running turn goes on.
5. Add a case for a stop with no `turnId`, and one for a result with no `turnId`.
6. Give each case's client result the turn its call is in.
7. Write the answer to a stop in `AHP.md`, `AGENT.md` and the spec.

## Validation

- The changed and new cases fail on `a8eff676` and pass after.
- The touched test files pass.
- `pnpm run typecheck` is clean.

## Resume
