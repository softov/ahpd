---
title: The MCP request is paired to its call and waits on the client
status: todo
depends: [task-01-a-clients-call-is-recognised-when-reported.md]
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session/opening.ts#L155-L172](../../../../packages/agent-acp/src/session/opening.ts#L155-L172) - `toolsServer`, which now hands the runner"
  - "[code://packages/sdk/src/toolserver.ts#L102-L128](../../../../packages/sdk/src/toolserver.ts#L102-L128) - what the runner is handed"
  - "[code://packages/agent-claude/src/session/clienttools.ts#L117-L149](../../../../packages/agent-claude/src/session/clienttools.ts#L117-L149) - claude's name-and-input join, whichever side comes first"
  - "[code://packages/agent-acp/test/fixtures/acp-server.mjs](../../../../packages/agent-acp/test/fixtures/acp-server.mjs) - the fake server, which learns to call an HTTP MCP tool"
---

## Objective

A `tools/call` for a client's tool on the session's endpoint finds the call the agent reported, waits on the owning client through the holder, and answers the agent with the client's whole content, whichever of the two arrived first.

## Files

- `UPDATE: packages/agent-acp/src/session/opening.ts:155-172` - `start.toolsServer(runClient)`.
- `CREATE: packages/agent-acp/src/session/clientcalls.ts` - the pairing (`_meta` id, then same arguments, then oldest), the own-row fallback, and the runner.
- `UPDATE: packages/agent-acp/test/fixtures/acp-server.mjs` - a scripted turn that reports a `tool_call` and calls the `ahp` server over HTTP.
- `CREATE: packages/agent-acp/test/agent-acp-client-tool.test.ts` - the cases below.

## Steps

1. Write the cases first and see the call refused as today.
2. The runner pairs the request to an open owned call: `_meta['claudecode/toolUseId']` when it names one, else the oldest open call of that tool with the same arguments, else the oldest open call of that tool.
3. With no open call of that tool, it opens a row of its own: a fresh id, `chat/toolCallStart` with the client contributor, the running ready, and `calls.open`; the log says the agent reported none.
4. It waits on `calls.wait(id)` and returns the `ClientCallAnswer`, which the tool server turns into MCP content.

## Validation

- `packages/agent-acp/test/agent-acp-client-tool.test.ts`, written first:
  - the agent reports the call then calls the tool: the owner's `completeToolCall` answers the MCP request and the agent's `tool_call_update` completes the row.
  - two open calls of one tool with different arguments: each request pairs with the call whose arguments match.
  - two open calls with the same arguments and no `_meta`: the oldest is paired first.
  - `_meta['claudecode/toolUseId']` naming the call pairs it even when two open calls have the same arguments.
  - another client's answer is refused and the request still waits.
  - the owner leaves mid-call: the MCP request answers `isError` with the gone text.
  - nobody answers: the request answers `isError` at the timeout.
  - no reported call at all: a row of its own opens with the client on its start, and the owner's answer completes it.
  - a client answering with a text and a PNG block: the agent's MCP result holds a text and an `image` block.

## Resume
