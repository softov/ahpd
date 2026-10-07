---
title: An ACP agent calls a client's tool
domain: host
status: built
priority: high
created: 2026-10-06
revalidated: 2026-10-06
requires:
  - plans/host/62-every-backend-calls-a-clients-tool-p1-the-sdk-holds-a-client-call/plan.md
  - plans/acp/11-the-agent-gets-mcp-servers/plan.md
refs:
  - "[code://packages/agent-acp/src/session/opening.ts#L127-L145](../../../../packages/agent-acp/src/session/opening.ts#L127-L145) - the host's tools go to the agent as one HTTP MCP server named `ahp`"
  - "[code://packages/agent-acp/src/session/opening.ts#L155-L172](../../../../packages/agent-acp/src/session/opening.ts#L155-L172) - the endpoint is asked for once and kept for the session"
  - "[code://packages/agent-acp/src/mapping.ts#L88-L113](../../../../packages/agent-acp/src/mapping.ts#L88-L113) - `callOf` opens the row from the agent's `tool_call`, naming it by `name` or `title`"
  - "[code://packages/agent-acp/src/mapping.ts#L410-L447](../../../../packages/agent-acp/src/mapping.ts#L410-L447) - `tool_call` emits the start; the ready goes out once the agent moves the call off `pending`"
  - "[code://packages/agent-acp/src/session.ts#L186-L200](../../../../packages/agent-acp/src/session.ts#L186-L200) - the snapshot, with no `inputNeeded`"
  - "[code://packages/agent-acp/src/session.ts#L231-L242](../../../../packages/agent-acp/src/session.ts#L231-L242) - `cancel`"
  - "[code://packages/agent-acp/src/session.ts#L266-L321](../../../../packages/agent-acp/src/session.ts#L266-L321) - none of the four client-tool members, and `close`"
  - "[code://packages/sdk/src/toolserver.ts#L102-L128](../../../../packages/sdk/src/toolserver.ts#L102-L128) - the MCP `tools/call` carries the name, the arguments and `_meta`, and no ACP tool call id"
  - "[code://packages/agent-acp/test/agent-acp-catalog.test.ts#L227-L320](../../../../packages/agent-acp/test/agent-acp-catalog.test.ts#L227-L320) - the host tools server in the ACP tests"
  - "[code://packages/agent-acp/test/fixtures/acp-server.mjs](../../../../packages/agent-acp/test/fixtures/acp-server.mjs) - the fake ACP server the tests drive"
  - "[code://packages/agent-acp/src/plugin.ts#L60-L90](../../../../packages/agent-acp/src/plugin.ts#L60-L90) - the plugin and per-agent `hostTools` options, beside which `toolsChanged` goes"
  - "https://modelcontextprotocol.io/specification/2025-06-18/server/tools#list-changed-notification - `notifications/tools/list_changed`"
  - "npm://@agentclientprotocol/sdk@^1.5.0 - `ToolCall.name` is optional and `title` is free text (`dist/schema/types.gen.d.ts:3425-3477`)"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - a client contributor arriving after `chat/toolCallStart` is ignored (`channels-chat/reducer.ts:59-79`)"
---

## Goal

An ACP agent is offered the tools a session's clients provide.
They reach it through the host's MCP tool server it already gets.
Its call to one is reported against the owning client, and raised on the session.
That client answers the call with its whole content.
A tool a client announces later reaches the agent by a notification or on its next `tools/list`, as the `toolsChanged` option says.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### What ACP has today

The agent gets the host's tools as the `ahp` HTTP MCP server (acp/11), opened once with the tools the session had then.
A client's tool is in that list, and the tool server refuses its call.
The ACP session takes no `setTools`, so a client that arrives later is never offered.
Nothing reports a call against a client.

### The matching problem

Two things arrive for one call, and neither names the other.
The first is the agent's `session/update` `tool_call`, with the ACP `toolCallId`.
The second is the MCP `tools/call`, with the name and arguments.
The contributor must be on `chat/toolCallStart`, which comes from the `tool_call`.
So the call is recognised as a client's from what the agent reports.
The MCP request is then paired to it.

### Searches performed

- `rg -n "setTools|toolCallOwner|completeToolCall|clientGone" packages/agent-acp/src` - nothing.
- `rg -n "'name' in update" packages/agent-acp/src` - `callOf` already reads ACP's optional `name`.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| - | None. | - |

| What | Source | Task |
| --- | --- | --- |
| The ACP agent calls a client's tool through the host's tool server | Softov, 2026-10-06: "lets make acp, cofold, pi and claude call a client tool" | 01-04 |
| The contributor is set when the agent reports the call, on `chat/toolCallStart` | AHP 1.0.0 `channels-chat/reducer.ts:59-79` | 01 |
| A `tool_call` is a client's when its `name`, then its `title`, is a session client tool's `<clientId>__<name>`, whole or after an `mcp__ahp__` prefix | Softov, 2026-10-06, asked "how is a `tool_call` recognised as a client's?": "Name, then title" | 01 |
| An MCP request finds its call by `_meta['claudecode/toolUseId']` when that names an open call, else the oldest open call of that tool with the same arguments, else the oldest open call of that tool | Softov, 2026-10-06, asked "how does an MCP request find its call?": "_meta, args, oldest" | 02 |
| An MCP request that pairs with no reported call opens a row of its own, with a fresh id and the client named on its start | Softov, 2026-10-06, asked "what does an MCP request with no reported call do?": "Own row" | 02 |
| How an agent hears of tools announced after it listed them is an acp option, `toolsChanged: "notify" \| "list"`: `notify` sends `notifications/tools/list_changed` from the tool server, `list` leaves it to the agent's next `tools/list`, and both always serve the current list | Softov, 2026-10-06, asked "what about a client tool announced after the agent listed its tools?": "configurable if possible" | 03, 04 |
| `toolsChanged` defaults to `notify` | (defaulted: `notify`, since an agent that ignores the notification still gets the current list on its next `tools/list`) | 03 |
| The agent gets the client's images and resources through the tool server's MCP content | the parent's row, Softov, 2026-10-06: "Everything now" | 02 |
| An owned call a person is asked about is opened at the approval, because it never gets a running ready | [`code://packages/agent-acp/src/mapping.ts#L171-L176`](../../../../packages/agent-acp/src/mapping.ts#L171-L176) - `mayReady` holds the ready back for a call that was `asked`, so such a call is opened from [`code://packages/agent-acp/src/session/handlers.ts`](../../../../packages/agent-acp/src/session/handlers.ts)' `confirm`, on approval | 01 |

## Proposed architecture

- **Data flow** - ACP `tool_call` -> recognised as `<clientId>__<name>` -> start with the contributor -> running ready -> `calls.open`; MCP `tools/call` -> tool server -> the session's runner -> paired call id -> `calls.wait`.
- **Event flow** - the agent's `tool_call_update` with a terminal status completes the row as today.
- **State flow** - the snapshot gains `inputNeeded` from `calls.entries()`.
- **Layer responsibilities** - agent-acp only, on p1's runner and `setTools`.
- **Source-of-truth files** - [`code://packages/agent-acp/src/mapping.ts`](../../../../packages/agent-acp/src/mapping.ts), [`code://packages/agent-acp/src/session.ts`](../../../../packages/agent-acp/src/session.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A client's call is recognised when the agent reports it](task-01-a-clients-call-is-recognised-when-reported.md) | done | p1 |
| [02 - The MCP request is paired to its call and waits on the client](task-02-the-mcp-request-is-paired-to-its-call.md) | done | 01 |
| [03 - The ACP session takes the clients' tools and lets go of their calls](task-03-the-acp-session-takes-the-clients-tools.md) | done | 02 |
| [04 - The README says it, and an ACP agent runs a VS Code tool by hand](task-04-readme-and-by-hand.md) | done | 03 |

## Risks and tradeoffs

- Each ACP agent spells an MCP tool's `name` and `title` its own way.
  Task 01 is tested on the spellings Softov's answer names.
  Task 04 runs a real agent.
- An agent may ignore `list_changed` and never list again.
  `list` and `notify` both serve the current list.
  The README says what such an agent misses.

## Resume state

- **Done so far:** tasks 01, 02 and 03.
  A `tool_call` the agent reports for a client's tool opens with the client contributor.
  The contributor is on `chat/toolCallStart`, `chat/toolCallReady` and the row.
  The call is recognised by the ACP `name`, then the `title`, against what the session may offer, whole or after `mcp__ahp__`.
  The running ready opens the call in the sdk holder.
  An approval opens it too, for a call a person was asked about.
  Nine cases are in `packages/agent-acp/test/agent-acp-turn.test.ts`, which had 22.
  The `tools/call` the agent makes on the session's own MCP endpoint finds that call.
  It looks first for `_meta['claudecode/toolUseId']`, then at the arguments, then at the oldest still open.
  It waits on the owner through the holder, and opens a row of its own when the agent reported none.
  The session spreads the holder's `toolCallOwner`, `completeToolCall` and `clientGone`.
  So a client's `chat/toolCallComplete` settles the agent's request.
  Nine cases are in `packages/agent-acp/test/agent-acp-client-tool.test.ts`, which is new, and the fixture's `mrep=`/`mreq=` script.
  Then the session's `setTools` keeps both the offering and the endpoint's list current.
  So a client that arrives is a tool the agent can call.
  `toolsChanged` is a plugin option and a per-preset one, `notify` by default, and the endpoint is opened with it.
  The snapshot lists the open calls as `inputNeeded` while there are any.
  `cancel` and `close` release them with `The turn was stopped` and `The session was closed`.
  Nine more cases are in `agent-acp-client-tool.test.ts`, which now has 18.
- **And then task 04**, which is the README's paragraph on client tools.
  The options table's own rows for `toolsChanged` had to land in task 03, because `agent-acp-options.test.ts` holds the schema to the table.
  The by-hand run the task also asks for needs a live daemon, a real agent and a VS Code.
  It waits in `deferred.md`.
- **Next action:** none; the tasks are done, reviewed on 2026-10-06. The by-hand run waits in [deferred.md](deferred.md).
- **Open questions:** none.
- **Watch out for:** the agent's own permission request for the MCP tool comes before the call runs.
  The entry opens at the running ready, never at `pending`.
  It opens at the approval for a call that has one, because such a call never gets a running ready.
  A test may not answer a call until its `tools/call` has landed on the listener.
  The request is paired, waited on and answered in one microtask chain, so a marker on the subprocess's pipe is not a barrier.
  The pairing reads open calls only, so an owner that answers before the request arrived is not paired at all.
  That corner waits in `deferred.md`.

## Final verification checklist

- [x] `vitest run packages/agent-acp` green: 201 cases in 14 files.
- [ ] By hand: VS Code connected to ahpd runs one of its tools for an ACP session. Not made here - it needs a live daemon; it waits in `deferred.md`.
- [x] `plans/index.md` updated.
