---
title: An ACP agent calls a client's tool
domain: host
status: planned
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

An ACP agent is offered the tools a session's clients provide, through the host's MCP tool server it already gets, and its call to one is reported against the owning client, raised on the session, and answered by that client with its whole content.
A tool a client announces later reaches the agent by a notification or on its next `tools/list`, as the `toolsChanged` option says.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### What ACP has today

The agent gets the host's tools as the `ahp` HTTP MCP server (acp/11), opened once with the tools the session had then.
A client's tool is in that list, and the tool server refuses its call; the ACP session takes no `setTools`, so a client that arrives later is never offered; nothing reports a call against a client.

### The matching problem

Two things arrive for one call and neither names the other: the agent's `session/update` `tool_call` with the ACP `toolCallId`, and the MCP `tools/call` with the name and arguments.
The contributor must be on `chat/toolCallStart`, which is emitted from the `tool_call`, so the call is recognised as a client's from what the agent reports, and the MCP request is then paired to it.

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

## Proposed architecture

- **Data flow** - ACP `tool_call` -> recognised as `<clientId>__<name>` -> start with the contributor -> running ready -> `calls.open`; MCP `tools/call` -> tool server -> the session's runner -> paired call id -> `calls.wait`.
- **Event flow** - the agent's `tool_call_update` with a terminal status completes the row as today.
- **State flow** - the snapshot gains `inputNeeded` from `calls.entries()`.
- **Layer responsibilities** - agent-acp only, on p1's runner and `setTools`.
- **Source-of-truth files** - [`code://packages/agent-acp/src/mapping.ts`](../../../../packages/agent-acp/src/mapping.ts), [`code://packages/agent-acp/src/session.ts`](../../../../packages/agent-acp/src/session.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A client's call is recognised when the agent reports it](task-01-a-clients-call-is-recognised-when-reported.md) | todo | p1 |
| [02 - The MCP request is paired to its call and waits on the client](task-02-the-mcp-request-is-paired-to-its-call.md) | todo | 01 |
| [03 - The ACP session takes the clients' tools and lets go of their calls](task-03-the-acp-session-takes-the-clients-tools.md) | todo | 02 |
| [04 - The README says it, and an ACP agent runs a VS Code tool by hand](task-04-readme-and-by-hand.md) | todo | 03 |

## Risks and tradeoffs

- Each ACP agent spells an MCP tool's `name` and `title` its own way - task 01 is tested on the spellings Softov's answer names, and task 04 runs a real agent.
- An agent may ignore `list_changed` and never list again - `list` and `notify` both serve the current list, and the README says what such an agent misses.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-clients-call-is-recognised-when-reported.md](task-01-a-clients-call-is-recognised-when-reported.md).
- **Open questions:** none.
- **Watch out for:** the agent's own permission request for the MCP tool comes before the call runs; the entry opens at the running ready, never at `pending`.

## Final verification checklist

- [ ] `vitest run packages/agent-acp` green.
- [ ] By hand: VS Code connected to ahpd runs one of its tools for an ACP session.
- [ ] `plans/index.md` updated.
