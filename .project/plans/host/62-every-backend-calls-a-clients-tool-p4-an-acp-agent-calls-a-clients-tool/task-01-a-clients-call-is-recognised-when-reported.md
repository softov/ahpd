---
title: A client's call is recognised when the agent reports it
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/mapping.ts#L88-L113](../../../../packages/agent-acp/src/mapping.ts#L88-L113) - `callOf`, where the row is opened"
  - "[code://packages/agent-acp/src/mapping.ts#L410-L447](../../../../packages/agent-acp/src/mapping.ts#L410-L447) - `tool_call` and `tool_call_update`"
  - "[code://packages/agent-acp/src/types.ts](../../../../packages/agent-acp/src/types.ts) - `AcpTurn` and `AcpCall`, which gain the owner"
  - "[code://packages/agent-pi/src/mapping.ts#L120-L140](../../../../packages/agent-pi/src/mapping.ts#L120-L140) - pi's `ownerOf` on the turn, the shape to mirror"
---

## Objective

A `tool_call` the agent reports for a client's tool opens with `contributor: { kind: 'client', clientId }` on `chat/toolCallStart`, `chat/toolCallReady` and the snapshot row, and the running ready opens the call in the sdk holder.

## Files

- `UPDATE: packages/agent-acp/src/types.ts` - `AcpTurn.ownerOf(name, title)` and `AcpCall.owner`.
- `UPDATE: packages/agent-acp/src/mapping.ts:88-113, 410-447` - recognise by name, then title; the contributor on start, ready and part; a hook when an owned call's ready goes out running.
- `UPDATE: packages/agent-acp/test/agent-acp-turn.test.ts` - the cases below.

## Steps

1. Write the cases first and see them fail on the missing contributor.
2. Give the turn the owner lookup from the session's current tools: ACP `name` first, then `title`, each matched against `<clientId>__<name>` whole or after `mcp__ahp__`; anything else is not a client's call.
3. Put the contributor on the start, and repeat it on the ready as the protocol allows.
4. Call the session's `open` when an owned call's ready goes out running.

## Validation

- `packages/agent-acp/test/agent-acp-turn.test.ts`, written first:
  - a `tool_call` named `mcp__ahp__a__openFile`, and one with only that `title`, opens with client `a` on the start.
  - two clients providing `openFile`: `a__openFile` is `a`'s and `b__openFile` is `b`'s.
  - a `name` that is not a client tool's wins over a `title` that is: the call carries no contributor.
  - a host tool and an agent's own tool carry no contributor.
  - every emitted action passes the protocol's reducers with the contributor kept.

## Resume
