---
title: A client's result is checked against its call
status: done
depends: [01]
layer: "sdk host, agent-claude"
refs:
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - `chat/toolCallComplete` and `chat/toolCallContentChanged`"
  - "[code://packages/agent-claude/src/session/stream.ts](../../../../packages/agent-claude/src/session/stream.ts) - where a Claude call opens"
  - "[code://packages/agent-claude/src/session/asking.ts](../../../../packages/agent-claude/src/session/asking.ts) - where a call a question asks about opens"
  - "[code://packages/agent-claude/src/session/clienttools.ts](../../../../packages/agent-claude/src/session/clienttools.ts) - where a client's call is handed to the holder"
  - "[code://packages/sdk/src/tools/clientcalls.ts](../../../../packages/sdk/src/tools/clientcalls.ts) - the holder that raises a client call's entry"
---

## Objective

A client's result and streamed content are refused unless the chat's held state has the call running under that client's contributor.
A Claude call a client runs names that client from its start, and a worker's call raises its entry under the worker's chat.

## Files

- `UPDATE: packages/agent-claude/src/session/stream.ts:202-232` - the start names a client's own tool by its client.
- `UPDATE: packages/agent-claude/src/session/asking.ts:403-411` - a start a question opens names the same contributor.
- `UPDATE: packages/sdk/src/tools/clientcalls.ts:40-55` - `ClientCall.chat`, the chat a call's entry names when it is not the holder's.
- `UPDATE: packages/agent-claude/src/session/clienttools.ts:370-410` - a worker's call is opened under the worker's chat.
- `UPDATE: packages/sdk/src/host/chatactions.ts:1808-1866` - the contributor is read off the held call before the backend is handed the result.
- `UPDATE: packages/sdk/test/host-tools.test.ts` - a streamed start and a question's start name the client.
- The same file - a backend's held call is started on its chat under its client before a client answers it.
- `UPDATE: packages/agent-claude/test/agent-claude-subagent.test.ts` - a worker's client call is raised under the worker's chat.
- `UPDATE: packages/agent-claude/test/agent-claude-client-gone.test.ts` - the test's session context finds no worker for a call.

## Steps

1. Name a client's tool by `{ kind: 'client', clientId }` at its `chat/toolCallStart`, in the stream and in a question's start.
2. Add an optional `chat` to `ClientCall`, read in place of the holder's for that call's entry.
3. Open a worker's client call with the worker's chat.
4. Read the running call and its contributor off the held state in `chat/toolCallComplete` and `chat/toolCallContentChanged`.
5. Send streamed content on the chat the call is in.
6. Refuse a result the backend holds no call for, a second result among them, as R1 refuses one.
7. Run the client tool suites and the subagent suites.

## Validation

- A client tool's start names its client, and a worker's call's entry names the worker's chat.
- `host-tools.test.ts`, `subagent-chat.test.ts`, `agent-claude-subagent.test.ts` and `clientcalls.test.ts` pass.

## Resume

Done. Before the change a streamed start named `mcp:ahp`, a question's start named nobody, and a worker's call was raised under the lead chat.
The four suites pass.
