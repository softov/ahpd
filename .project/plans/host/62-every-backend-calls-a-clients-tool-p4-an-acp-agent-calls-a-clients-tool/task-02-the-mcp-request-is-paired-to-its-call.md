---
title: The MCP request is paired to its call and waits on the client
status: done
depends: [task-01-a-clients-call-is-recognised-when-reported.md]
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session/opening.ts#L155-L172](../../../../packages/agent-acp/src/session/opening.ts#L155-L172) - `toolsServer`, which now hands the runner"
  - "[code://packages/sdk/src/toolserver.ts#L102-L128](../../../../packages/sdk/src/toolserver.ts#L102-L128) - what the runner is handed"
  - "[code://packages/agent-claude/src/session/clienttools.ts#L117-L149](../../../../packages/agent-claude/src/session/clienttools.ts#L117-L149) - claude's name-and-input join, whichever side comes first"
  - "[code://packages/agent-acp/test/fixtures/acp-server.mjs](../../../../packages/agent-acp/test/fixtures/acp-server.mjs) - the fake server, which learns to call an HTTP MCP tool"
---

## Objective

A `tools/call` for a client's tool on the session's endpoint finds the call the agent reported.
It waits on the owning client through the holder.
It answers the agent with the client's whole content, whichever of the two arrived first.

## Files

- `UPDATE: packages/agent-acp/src/session/opening.ts:155-172` - `start.toolsServer(runClient)`.
- `UPDATE: packages/agent-acp/src/session/clientcalls.ts` - the pairing (`_meta` id, then same arguments, then oldest), the own-row fallback, and the runner; the file exists from task 01, holding the holder, `ownerOf` and `setTools`.
- `UPDATE: packages/agent-acp/src/types.ts` - the `log` option's doc, which now also covers a call the bridge names itself.
- `UPDATE: packages/agent-acp/test/fixtures/acp-server.mjs` - a scripted turn that reports a `tool_call` and calls the `ahp` server over HTTP.
- `CREATE: packages/agent-acp/test/agent-acp-client-tool.test.ts` - the cases below.

## Steps

1. Write the cases first and see the call refused as today.
2. Pair the request to an open owned call.
   Use `_meta['claudecode/toolUseId']` when it names one.
   Else take the oldest open call of that tool with the same arguments.
   Else take the oldest open call of that tool.
3. Open a row of its own when no call of that tool is open.
   Give it a fresh id, `chat/toolCallStart` with the client contributor, the running ready, and `calls.open`.
   Log that the agent reported none.
4. It waits on `calls.wait(id)` and returns the `ClientCallAnswer`, which the tool server turns into MCP content.

## Validation

- `packages/agent-acp/test/agent-acp-client-tool.test.ts`, written first:
  - See the agent report the call, then call the tool.
  - Check the owner's `completeToolCall` answers the MCP request, and the agent's `tool_call_update` completes the row.
  - Open two calls of one tool with different arguments.
  - Check each request pairs with the call whose arguments match.
  - Open two calls with the same arguments and no `_meta`.
  - Check the request takes the oldest one.
  - Name the call with `_meta['claudecode/toolUseId']`, and check it pairs even when two open calls have the same arguments.
  - Refuse another client's answer, and check the request still waits.
  - Take the owner away mid-call, and check the MCP request answers `isError` with the gone text.
  - Leave the call unanswered, and check the request answers `isError` at the timeout.
  - Report no call at all, and check a row of its own opens with the client on its start.
  - Check the owner's answer completes it.
  - Answer with a text and a PNG block.
  - Check the agent's MCP result holds a text and an `image` block.

## Resume

- **Done:** `packages/agent-acp/src/session/clientcalls.ts` has `ranByClient`, the runner the tool server is handed.
  `callFor(owner, name, input, meta)` is the pairing.
  It takes the `_meta['claudecode/toolUseId']` the agent put on the request when `calls.owner(id)` says this owner.
  Else it takes the oldest open call of that tool with the same arguments.
  Else it takes the oldest open call of that tool.
  Else it calls `openOwn`.
  `openOwn(owner, name, input)` makes a fresh `ahp-mcp-<n>` id, and logs that the agent reported none through the plugin's `log`.
  Then it opens the call the ordinary way.
  `ranByClient` strips `<clientId>__` off the offered name to get the name the client answers to, and returns `await calls.wait(id)`.
  `packages/agent-acp/src/session/opening.ts` hands `{ runClient: ctx.ranByClient }` to `start.toolsServer`.
  `packages/agent-acp/src/session.ts` spreads `ctx.calls.methods` onto the session, so a client's `chat/toolCallComplete` reaches the holder.
  The fixture's `mrep=`/`mreq=` script reports a `tool_call` per `mrep=`, reads a file as a barrier, and really POSTs `tools/call` per `mreq=`.
  It says each result as one `mcp=<url-encoded JSON>` chunk.
  Nine cases are in `packages/agent-acp/test/agent-acp-client-tool.test.ts`, which is new.
- **Failed first:** the nine cases were written before the runner, and run against the tree as it stood.
  Nine of nine failed.
  The request was refused with `expected [] to deeply equal [ { isError: false, … } ]`, and three of them timed out at five seconds.
- **The name the own row is opened under matters.**
  The first cut passed the bare `openFile` into `openCall`.
  `openCall` looks the name up in the offering, and holds nothing when it does not find it.
  So the row was drawn and the call was never held.
  The agent was told `ahp-mcp-1 is not a call a client is running here`.
  The row is opened under `<clientId>__<name>`, the name on the list the agent called it from.
  `openCall` strips the client id for the entry.
  So what the client is asked through is still its own `openFile`.
- **A test may not answer a call until the request has been taken.**
  The fixture's `calling=<n>` chunk was meant to be that signal.
  But a marker on the subprocess's pipe beats a request that still has a socket hop, a listener and a body read.
  Measuring it proved the point.
  The entry was raised at the report, and removed by the test's own answer before the request landed.
  So the request found no open call and opened a row of its own.
  The signal is now the test's own listener counting what it has received.
  From `ToolsServers.request` the read, the pairing and the wait are one microtask chain with no turn of the event loop in them.
  So a test that has seen the request arrive is a test that may answer.
  The `calling=` chunk is gone from the fixture, and the `arrived` count is in the test's `serve`.
- **What the decisions leave unhelpful, and where it goes:** an owning client whose answer lands before the agent's `tools/call` gets no pairing.
  The decision `_meta, args, oldest` reads open calls only.
  A settled call is not an open one.
  So the request opens a row of its own, and the agent waits on a client it has already heard from.
  Handling it means pairing a request with a finished call.
  That is a rule the plan does not decide, so it is written up in `deferred.md` rather than invented here.
- **Verification:** `npx vitest run packages/agent-acp/test/agent-acp-client-tool.test.ts` is green, 9 cases, repeated runs stable.
  `npx tsc -b` is green.
  `pnpm boundary` is green (`@ahpd/agent-acp: 2 declared, none undeclared`).
  `npx vitest run packages/agent-acp` is 191 passed and the one failure task 01 recorded.
  That failure is `agent-acp-machine.test.ts > reaches a disposable machine`.
  It passes on its own at 4.9 s, and tips past the default 5 s under the whole suite's load.
- **Next action:** [task-03-the-acp-session-takes-the-clients-tools.md](task-03-the-acp-session-takes-the-clients-tools.md), which is `entries()` in `sessionState`, `calls.release` on cancel and close, and `toolsChanged` on the endpoint.
