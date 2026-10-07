---
title: Every backend calls a client's tool, acp, cofold, pi and claude, the way the protocol asks
domain: host
status: built
priority: high
created: 2026-10-06
revalidated: 2026-10-06
requires:
  - plans/acp/11-the-agent-gets-mcp-servers/plan.md
refs:
  - "[code://packages/sdk/src/host/tooling.ts#L124-L170](../../../../packages/sdk/src/host/tooling.ts#L124-L170) - `clientTools` names a client's tool `<clientId>__<name>` with an `owner` and no `run`; `retool` hands every chat the new set through `setTools`"
  - "[code://packages/sdk/src/types/agent.ts#L77-L107](../../../../packages/sdk/src/types/agent.ts#L77-L107) - `BoundTool`: `run` absent and `owner` set for a client's tool"
  - "[code://packages/sdk/src/types/session.ts#L426-L471](../../../../packages/sdk/src/types/session.ts#L426-L471) - `setTools`, `toolCallOwner`, `completeToolCall` and `clientGone`, the four members a backend implements to take client tools"
  - "[code://packages/sdk/src/host/chatactions.ts#L1056-L1131](../../../../packages/sdk/src/host/chatactions.ts#L1056-L1131) - a client's `chat/toolCallComplete` is read down to `{ text, ok }` and handed to `completeToolCall`; `chat/toolCallContentChanged` is relayed only from `toolCallOwner`"
  - "[code://packages/sdk/src/host.ts#L658-L679](../../../../packages/sdk/src/host.ts#L658-L679) - `leaves`: a client that goes calls `clientGone` on every chat and then `retool`"
  - "[code://packages/sdk/src/toolserver.ts#L102-L128](../../../../packages/sdk/src/toolserver.ts#L102-L128) - the tool server refuses a tool with no `run` at line 111, which is every client's tool"
  - "[code://packages/agent-claude/src/session/clienttools.ts](../../../../packages/agent-claude/src/session/clienttools.ts) - claude's client calls, the pattern pi and cofold copied"
  - "[code://packages/agent-pi/src/session.ts#L185-L215](../../../../packages/agent-pi/src/session.ts#L185-L215) - pi's copy: `byClient`, `releaseCalls`, `ranByClient`"
  - "[code://packages/agent-cofold/src/turnagent.ts#L115-L150](../../../../packages/agent-cofold/src/turnagent.ts#L115-L150) - cofold's copy: `waiting`, `releaseCalls`, the relay"
  - "[code://packages/agent-acp/src/session.ts#L266-L276](../../../../packages/agent-acp/src/session.ts#L266-L276) - the ACP session has no `setTools`, `toolCallOwner`, `completeToolCall` or `clientGone`"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `SessionToolClientExecutionRequest` (`channels-session/state.ts:370-404`), `ToolCallClientContributor` (`channels-chat/state.ts:1329-1340`), `chat/toolCallComplete` and its MAY-time-out (`channels-chat/actions.ts:309-339`), `refineToolCallContributor` ignoring a late client contributor (`channels-chat/reducer.ts:59-79`)"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/chatContributions/sessionInputNeeded/sessionInputNeededContribution.ts#L104-L145 - VS Code's host raises a `toolClientExecution` entry for every running call with a client contributor and removes it when the call moves on"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L2700-L2725 - VS Code's client picks up the calls it runs from the session's `inputNeeded`"
---

## Goal

A tool a client announces in `SessionActiveClient.tools` can be called by the agent in every backend ahpd ships: claude, pi, cofold and ACP.
The call is reported against the client that owns it.
It is raised on the session as the protocol's `toolClientExecution` request, so a client watching only the session finds it.
It waits for that client's `chat/toolCallComplete`.
A call whose client leaves, or that nobody answers, ends with a failure the model reads rather than a turn that hangs.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "toolCallOwner|completeToolCall|clientGone|setTools" packages` - claude, pi and cofold implement all four; agent-acp implements none.
- `rg -n "ToolClientExecution|toolClientExecution" packages` - nothing: no backend raises the protocol's execution request.
- `rg -n "timeout|setTimeout" packages/agent-claude/src/session/clienttools.ts packages/agent-pi/src/session.ts packages/agent-cofold/src/turnagent.ts` - no client call has a time limit.
- `rg -ln "ToolClientExecution" /github/externals/vscode/src` at `7516b04bc94` - the host mirror, the client's watcher, and the 30 s disconnect grace in `protocolServerHandler.ts`.
- `grep -a -c "claudecode/toolUseId"` on the claude CLI binary from `@anthropic-ai/claude-agent-sdk-linux-x64@0.3.278` - 4 hits; VS Code reads the call id from that `_meta` key in its in-process MCP handler.
- `rg -ln "client tool" .project` - pi/02 and plugin/04 built pi's and cofold's client calls on claude's pattern; host/49 task 04 plans the 30 s disconnect grace.

### Runtime path

```
client: session/activeClientSet { tools } -> host: clientTools() -> retool() -> Session.setTools(BoundTool[])
agent calls <clientId>__<name> -> backend: chat/toolCallStart { contributor: client } -> chat/toolCallReady (running)
  -> sdk client call: session/inputNeededSet { kind: toolClientExecution } -> owning client runs it
  -> client: chat/toolCallComplete -> host: completeToolCall -> the waiting tool resolves -> the harness writes the result
  -> backend: chat/toolCallComplete to everybody, session/inputNeededRemoved
```

### Gaps

- A client's result reaches every model as text only: `chatactions.ts` reads the text blocks and drops images and resources.
- No backend raises `toolClientExecution`, so a client that runs its calls from the session's `inputNeeded`, as VS Code's does, never runs ahpd's.
- Three backends hold the same waiting map in three copies, and none times a call out.
- Claude and pi register the wait when the harness runs the tool.
  That is after `chat/toolCallReady` has told the client to start.
  So an answer that comes back first is refused as `not a call <client> is running here`.
- Claude joins its MCP handler to the model's call by tool name and input; VS Code reads the id from `_meta['claudecode/toolUseId']`.
- The tool server refuses a client's tool.
  It serves the tools it was opened with for the life of the session.
  So an ACP agent is never offered a client's tool.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| - | None. | - |

| What | Source | Plan |
| --- | --- | --- |
| Every backend calls a client's tool: acp, cofold, pi and claude | Softov, 2026-10-06, asked what to do about ACP client tools: "not just acp, lets make acp, cofold, pi and claude call a client tool" | p1-p4 |
| A running call with a client contributor is raised as `session/inputNeededSet` with `kind: toolClientExecution` and removed when it ends, and it does not make the session read as needing input | AHP 1.0.0 `channels-session/state.ts:370-404`, `channels-session/reducer.ts:40-49` | p1 |
| A client's tool keeps the name `<clientId>__<name>`, so two clients providing one name are two tools | [`code://packages/sdk/src/host/tooling.ts#L133-L153`](../../../../packages/sdk/src/host/tooling.ts#L133-L153) | p1 |
| The client contributor is on `chat/toolCallStart`, because the reducer ignores one that arrives later | AHP 1.0.0 `channels-chat/reducer.ts:59-79`, `channels-chat/actions.ts:214-217` | p4 |
| The shared part is in the sdk first, then each backend moves onto it | the request, 2026-10-06 | p1 before p2-p4 |
| The sdk's shared client-call module raises and removes the `toolClientExecution` entry; the host stays a router | Softov, 2026-10-06, asked "who raises the entry: each backend through the shared module, or the host by mirroring chat actions as VS Code does?": "The shared module" | p1-p4 |
| A client call that gets no answer fails after 10 minutes, set by the daemon option `clientToolTimeoutMs`, where 0 is no limit | Softov, 2026-10-06, asked "how long does a client call wait, and can a person change it?": "10 min, configurable" | p1 |
| A client's whole result reaches the model now: each backend passes text, images and resources wherever its agent takes them and degrades to text only where it cannot, and each backend's tests cover an image result | Softov, 2026-10-06, asked "text only now, or images and resources too?": "Everything now" | p1-p4 |
| Every task's test is written first and seen to fail | the request, 2026-10-06 | p1-p4 |

## Proposed architecture

- **Data flow** - a client's `ToolDefinition` becomes a `BoundTool` with an `owner` (unchanged), and the backend offers it.
  The call is held by one sdk client-call holder, keyed by the call id the backend reports.
  The client's result, with its content blocks, comes back through `completeToolCall` into that holder.
  It goes out to the harness in the richest shape the harness takes.
- **Event flow** - the backend emits `chat/toolCallStart` with the contributor and `chat/toolCallReady` to `running`.
  The holder emits `session/inputNeededSet` and, on any end, `session/inputNeededRemoved`.
  The backend's own completion path emits `chat/toolCallComplete`.
- **State flow** - the holder's open entries are what the backend's snapshot lists under `inputNeeded`, beside its own confirmations and questions.
- **Layer responsibilities** - sdk: the holder, the timeout, and the tool server running a client's tool through a backend's runner.
  agent-claude, agent-pi, agent-cofold: replace their own maps with the holder, and open the entry when they report the call running.
  agent-acp: recognise a client's call when the agent reports it, pair the MCP request to it, and take `setTools`.
- **Source-of-truth files** - [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts), [`code://packages/sdk/src/toolserver.ts`](../../../../packages/sdk/src/toolserver.ts)

## Tasks

| Plan | Status | Depends on |
| --- | --- | --- |
| [p1 - The sdk holds a client call, raises it for the client, and runs one for the tool server](../62-every-backend-calls-a-clients-tool-p1-the-sdk-holds-a-client-call/plan.md) | built | - |
| [p2 - Claude runs its client calls through the sdk](../62-every-backend-calls-a-clients-tool-p2-claude-runs-client-calls-through-the-sdk/plan.md) | built | p1 |
| [p3 - pi and cofold run their client calls through the sdk](../62-every-backend-calls-a-clients-tool-p3-pi-and-cofold-run-client-calls-through-the-sdk/plan.md) | built | p1 |
| [p4 - An ACP agent calls a client's tool](../62-every-backend-calls-a-clients-tool-p4-an-acp-agent-calls-a-clients-tool/plan.md) | built | p1 |

## Risks and tradeoffs

- Moving three working backends onto one holder can break what pi/02 and plugin/04 verified.
  Each child keeps the backend's existing client-tool tests green before it adds new ones.
- An ACP agent's report of an MCP call is the agent's own shape.
  p4 matches on the fields ACP defines, then on the arguments, then opens a row of its own, as Softov answered.
- host/49 task 04 changes when a leaving client's calls fail, after 30 s rather than at once.
  These plans test through `clientGone`, which both timings end in.
  The timing stays with host/49.

## Resume state

- **Done so far:** all four children.
  p1 is reviewed and merged.
  The sdk's `createClientCalls` holds a call, raises it as the protocol's `toolClientExecution` entry and removes it.
  It runs one for the tool server through a backend's runner.
  p2, p3 and p4 are built and their tasks are `implemented`, waiting on review.
  claude, pi and cofold hold their client calls through the sdk's holder rather than three maps of their own.
  An ACP agent is offered its session's clients' tools through the host's own MCP server.
  Its `tools/call` is paired to the call the agent reported.
  Each child's `implemented.md` is the account of its own work.
  p2 and p4 each carry a `deferred.md`, and p3's account says nothing waits.
- **Next action:** none; every child is done, reviewed on 2026-10-06.
- **Open questions:** none; Softov answered all eight on 2026-10-06, and each answer is a row in the plan that owns it.
- **Watch out for:** `chat/toolCallComplete` from a client is not echoed by the host, and must not be.
  The backend reports the completion from what the harness wrote.
  A `toolClientExecution` entry must not set `InputNeeded` on the session.
  It must not fire a notification meant for a person.

## Final verification checklist

- [x] p1-p4 built, each with its `implemented.md`.
- [x] `npx tsc -b`, `pnpm boundary` and `npx vitest run` over the five packages this plan touches green - 168 files, 2265 tests - all recorded in this plan's `implemented.md`.
- [ ] `pnpm wire` against a capture with a client tool call validates the `inputNeeded` entry. Not made here: it needs a capture from a live daemon.
- [x] Each backend's tests cover an image result: claude's `hands the model the client's image as an image, and its words as words`, pi's `hands the model the client image as an image, and its other files as a line`, cofold's `carries a client's text and names the image it could not pass`, and ACP's `answers with the client's blocks as the MCP content an agent reads`.
- [ ] By hand: VS Code connected to ahpd runs one of its own tools for a claude, a pi, a cofold and an ACP session. Not made here: it needs a live daemon, and p2's and p4's `deferred.md` say what their runs would show.
- [x] `plans/index.md` updated.
