---
title: A claude client call is the sdk's, opened when it is announced running
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session/clienttools.ts#L151-L226](../../../../packages/agent-claude/src/session/clienttools.ts#L151-L226) - the map and the three members that go"
  - "[code://packages/agent-claude/src/session/stream.ts#L367-L445](../../../../packages/agent-claude/src/session/stream.ts#L367-L445) - where the running ready goes out"
  - "[code://packages/agent-claude/src/session.ts#L197](../../../../packages/agent-claude/src/session.ts#L197) - the snapshot's `inputNeeded`"
  - "[code://packages/agent-claude/src/session/turns.ts#L556-L560](../../../../packages/agent-claude/src/session/turns.ts#L556-L560) - `releaseCalls` on a stopped turn"
  - "[code://packages/agent-claude/src/session.ts#L249](../../../../packages/agent-claude/src/session.ts#L249) - `releaseCalls` on dispose"
---

## Objective

A claude call to a client's tool is opened in the sdk holder when `chat/toolCallReady` reports it running, so the entry is raised, an early answer is kept, the call times out, and the CLI gets the client's whole content; the existing client-tool behaviour is unchanged.

## Files

- `UPDATE: packages/agent-claude/src/session/clienttools.ts` - `byClient`, `releaseCalls` and the three members replaced by `createClientCalls`; `ranByClient` waits on `calls.wait(id)`; the handler answers `toMcpContent(answer, id)` with `isError` when `ok` is false.
- `UPDATE: packages/agent-claude/src/session/stream.ts:367-445` - `calls.open` beside the running ready for an owned call.
- `UPDATE: packages/agent-claude/src/session.ts:197` - `calls.entries()` in the snapshot.
- `UPDATE: packages/sdk/test/host-tools.test.ts` - the cases below, on the claude fake.

## Steps

1. Write the cases first and see the entry and early-answer cases fail.
2. Build the holder per chat with the session's `emit`, `Start.clientToolTimeoutMs` and the session's active clients as `providers`.
3. Open at the running ready; wait in the handler; release on stop and dispose as today.

## Validation

- `packages/sdk/test/host-tools.test.ts`, written first:
  - a claude call to a client's tool raises one `toolClientExecution` entry naming the owner and removes it when the answer is in.
  - the owner answers before the fake SDK invokes the handler, and the handler gets that answer.
  - the existing cases at lines 527-753 stay green.
  - an unanswered call fails at the timeout and the turn goes on.
  - a client answering with a text and a PNG block: the fake SDK's handler result holds a text block and an MCP `image` block.
- `vitest run packages/agent-claude` green.

## Resume
