---
title: An ACP agent calls a client's tool - implemented
date: 2026-10-06
refs:
  - git://build/agents/8cd9a284
  - "[code://packages/agent-acp/src/mapping.ts](../../../../packages/agent-acp/src/mapping.ts)"
  - "[code://packages/agent-acp/src/session/clientcalls.ts](../../../../packages/agent-acp/src/session/clientcalls.ts)"
  - "[code://packages/agent-acp/src/session/handlers.ts](../../../../packages/agent-acp/src/session/handlers.ts)"
  - "[code://packages/agent-acp/src/session/opening.ts](../../../../packages/agent-acp/src/session/opening.ts)"
  - "[code://packages/agent-acp/src/session.ts](../../../../packages/agent-acp/src/session.ts)"
  - "[code://packages/agent-acp/test/agent-acp-client-tool.test.ts](../../../../packages/agent-acp/test/agent-acp-client-tool.test.ts)"
  - "[code://packages/agent-acp/test/agent-acp-turn.test.ts](../../../../packages/agent-acp/test/agent-acp-turn.test.ts)"
---

An ACP agent's call to a tool a session's client provides is the protocol's `toolClientExecution` entry now.
The entry is raised against the client the tool belongs to, and listed in the session's `inputNeeded` while it is open.
The client answers it with its whole content: text, images and resources.
The agent reads that content as the tool result of the `tools/call` it is blocked on.

A client that connects after the agent listed its tools is offered to it.
The agent hears of it as the `toolsChanged` option says, `notify` by default.
A client that goes takes its tool off the list, and fails its open call.
A turn stopped or a session closed releases every call still out.
Neither the agent nor the client waits for an answer that is no longer coming.

The `tools/call` an agent makes is paired to the call the agent named, or to a single open call of that tool.
Two open calls with nothing to tell them apart are an error rather than a guess (the review of 2026-10-06).

## What was built

- [`code://packages/agent-acp/src/mapping.ts`](../../../../packages/agent-acp/src/mapping.ts) - a `tool_call` the agent reports is recognised as a client's.
  Its `name`, then its `title`, must be a `<clientId>__<name>` the session may offer, whole or after an `mcp__ahp__` prefix.
  The client rides as the contributor on `chat/toolCallStart`, the ready and the row.
  The running ready opens the call in the sdk holder.
- [`code://packages/agent-acp/src/session/handlers.ts`](../../../../packages/agent-acp/src/session/handlers.ts) - a call a person is asked about has no running ready, so the approval opens it.
- [`code://packages/agent-acp/src/session/clientcalls.ts`](../../../../packages/agent-acp/src/session/clientcalls.ts) - the session's holder over the sdk's `createClientCalls`.
  It is the runner the host tool server calls for a client's tool.
  The pairing looks first for `_meta['claudecode/toolUseId']`.
  It falls back to a single open call of that tool, then to the arguments.
  More than one open call and no arguments to match is an error naming the ambiguity (the review of 2026-10-06).
  A request that pairs with none gets a row of its own.
  `setTools` writes the offering and the endpoint's list in one move.
- [`code://packages/agent-acp/src/session/opening.ts`](../../../../packages/agent-acp/src/session/opening.ts) - the `ahp` HTTP MCP server is opened with the runner and with `toolsChanged`.
  The endpoint is kept and answered as `toolsEndpoint()`.
- [`code://packages/agent-acp/src/session.ts`](../../../../packages/agent-acp/src/session.ts) - the snapshot's `inputNeeded` is `calls.entries()` while there are any.
  `setTools` and the holder's `toolCallOwner`, `completeToolCall` and `clientGone` are the session's.
  `cancel` and `close` release the open calls with `The turn was stopped` and `The session was closed`.
- [`code://packages/agent-acp/src/plugin.ts`](../../../../packages/agent-acp/src/plugin.ts), [`code://packages/agent-acp/src/types.ts`](../../../../packages/agent-acp/src/types.ts) - `toolsChanged: "notify" | "list"`, plugin-wide and per preset like `hostTools`, in the options schema at both levels.
- [`code://packages/agent-acp/README.md`](../../../../packages/agent-acp/README.md) - the client tools paragraph in *What it does*, and the `toolsChanged` rows in the two options tables.
- [`code://packages/agent-acp/test/agent-acp-client-tool.test.ts`](../../../../packages/agent-acp/test/agent-acp-client-tool.test.ts) - new, 19 cases.
  [`code://packages/agent-acp/test/agent-acp-turn.test.ts`](../../../../packages/agent-acp/test/agent-acp-turn.test.ts) - nine more, 31 in all.
  [`code://packages/agent-acp/test/fixtures/acp-server.mjs`](../../../../packages/agent-acp/test/fixtures/acp-server.mjs) - the `mrep=` and `mreq=` script keys, so the fake agent reports a call and makes the MCP request for it.
  An `mrep=` with `-` for its arguments reports a call with no arguments, which is the case the pairing cannot decide (the review of 2026-10-06).

## Verified

- `npx vitest run packages/agent-acp` 202 cases in 14 files, with one failure: the flake in the bullet below.
- `packages/agent-acp/test/agent-acp-client-tool.test.ts` alone is 19 cases, all passing.
- `npx tsc -b` green, `pnpm boundary` green (`@ahpd/agent-acp: 2 declared, none undeclared`).
- Every case was written before the code it tests and seen to fail for its own reason.
  The nine in `agent-acp-turn.test.ts` failed on a start, a ready and a row with no contributor.
  Task 03's nine failed on the missing members, and on a five-second timeout.
  One failed on the `405` an endpoint opened with the tool server's own default answers a `GET`.
  Two more failed on no `inputNeeded`, and on no answer written for the close.
  The ambiguous-pairing case was seen to fail first as well, with both requests waiting on a call nothing answered (the review of 2026-10-06).
- One pre-existing flake, recorded by task 01 and not caused by this plan.
  `agent-acp-machine.test.ts > reaches a disposable machine` takes about 4.9 s on its own, and tips past the default five under the whole suite's load.
  It passed in the final run at 4858 ms.
  In the review's run it tipped again, at 5047 ms under the five packages' load, and passed alone at 4490 ms.
  The five packages' run repeated green (the review of 2026-10-06).

## Departures from the plan

- The README's `toolsChanged` rows are task 03's rather than task 04's.
  `agent-acp-options.test.ts` compares the options schema's property names with the first options table's, so the schema and the table have to move in the same change.
  Task 04's Files line still names the README, and the paragraph it asks for is there; the rows were already written.
- The endpoint is reached through `toolsEndpoint()` on the opening rather than handed to the session.
  It is opened inside the first `session/new`, and a session that has run no turn has none.
  Nothing in the plan's tables decided how it would be reached.
- No decision of the parent's was changed.
  One row of this plan's table is overtaken, and the code no longer follows it: the row `_meta, args, oldest`.
  The review of 2026-10-06 changed it.
  A lone open call is the only thing a nameless request can be for.
  Two open calls with no arguments to match answer with an error.
  The plan's row and task 02's `Resume` still read the old rule.
  Softov has yet to amend them (the review of 2026-10-06).

## Left for later

- The by-hand run: an ACP agent calling one of VS Code's tools through ahpd.
  It would have taken notes on the agent's `name` and `title` spellings.
  Also on `_meta['claudecode/toolUseId']`, and on whether any agent lists again after `list_changed`.
  See [deferred.md](deferred.md).
