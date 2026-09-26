---
title: A client's tool is run by that client
status: todo
depends: [task-01-host-tools-are-pi-tools.md]
layer: "agent-pi"
refs:
  - "[code://packages/agent-claude/src/session.ts#L775-L791](../../../../packages/agent-claude/src/session.ts#L775-L791) - `byClient`, `releaseCalls` and the wait, to copy"
  - "[code://packages/agent-claude/src/session.ts#L1469-L1475](../../../../packages/agent-claude/src/session.ts#L1469-L1475) - `contributor: { kind: 'client', clientId }` on the call"
  - "[code://packages/agent-claude/src/session.ts#L3286-L3316](../../../../packages/agent-claude/src/session.ts#L3286-L3316) - `toolCallOwner`, `completeToolCall`, `clientGone`"
  - "[code://packages/agent-pi/src/mapping.ts#L129-L150](../../../../packages/agent-pi/src/mapping.ts#L129-L150) - where the call is opened and readied"
  - "[code://packages/sdk/src/types/session.ts#L399-L427](../../../../packages/sdk/src/types/session.ts#L399-L427) - the three methods' contracts"
---

## Objective

A call pi makes to a client-owned tool is reported against that client, waits for that client's answer, and gives up with a failure when the client leaves.

## Files

- `UPDATE: packages/agent-pi/src/tools.ts` - a client-owned `execute` registers the call by pi's `toolCallId` and waits.
- `UPDATE: packages/agent-pi/src/session.ts` - `byClient` map, `releaseCalls`, and `toolCallOwner`, `completeToolCall`, `clientGone` on the returned `Session`; waiting calls released when the turn is cancelled and on `close`.
- `UPDATE: packages/agent-pi/src/mapping.ts:129-150` - `tool_execution_start` and `tool_execution_end` carry `contributor: { kind: 'client', clientId }` for a call to a client-owned tool; `PiTurn` learns which names are owned.
- `UPDATE: packages/agent-pi/src/types.ts` - `PiTurn` gains the owner lookup.
- `UPDATE: test/agent-pi.test.ts` - the cases below.

## Steps

1. The client-owned `execute(toolCallId, params)` puts `{ owner, settle }` in `byClient` under `toolCallId`, sets the activity to `Waiting on <owner>: <title>`, and awaits the answer. On `ok: false` it throws with the answer's text.
2. `toolCallOwner(id)` answers `byClient.get(id)?.owner`.
3. `completeToolCall(id, clientId, result)` settles only when `clientId` is the owner, and emits nothing: pi's `tool_execution_end` reports the completion through the path every other call takes.
4. `clientGone(clientId)` releases that client's calls as failed with "The client that provides this tool is no longer here", as the sibling says it.
5. `cancel` and `close` release every waiting call, so an aborted turn does not leave pi waiting.

## Validation

- `test/agent-pi.test.ts`: a client tool's `execute` does not resolve until `completeToolCall` from its owner; a result from another client answers `false` and leaves it waiting; `clientGone` rejects it; `toolCallOwner` names the owner while it waits and nothing after.
- The mapped `chat/toolCallStart` for a client tool carries the `contributor`.
- `pnpm test`, `pnpm typecheck`, `pnpm wire` green.

## Resume
