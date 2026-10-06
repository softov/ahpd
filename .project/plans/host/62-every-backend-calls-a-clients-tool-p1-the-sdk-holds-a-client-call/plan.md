---
title: The sdk holds a client call, raises it for the client, and runs one for the tool server
domain: host
status: planned
priority: high
created: 2026-10-06
revalidated: 2026-10-06
requires:
  - plans/host/62-every-backend-calls-a-clients-tool/plan.md
refs:
  - "[code://packages/sdk/src/types/session.ts#L426-L471](../../../../packages/sdk/src/types/session.ts#L426-L471) - the four members every backend implements by hand today"
  - "[code://packages/agent-claude/src/session/clienttools.ts#L151-L226](../../../../packages/agent-claude/src/session/clienttools.ts#L151-L226) - the waiting map, release, owner check and gone, which the holder takes over"
  - "[code://packages/agent-cofold/src/turnagent.ts#L229-L285](../../../../packages/agent-cofold/src/turnagent.ts#L229-L285) - cofold's gone message names the tool as well as the client"
  - "[code://packages/sdk/src/toolserver.ts#L102-L168](../../../../packages/sdk/src/toolserver.ts#L102-L168) - `answered` refuses a tool with no `run`; `open` fixes the tool list for the endpoint's life"
  - "[code://packages/sdk/src/host/spawn.ts#L364-L379](../../../../packages/sdk/src/host/spawn.ts#L364-L379) - `toolsServer` opens an endpoint on `boundTools` at the moment the backend asks"
  - "[code://packages/sdk/src/host/spawn.ts#L527-L548](../../../../packages/sdk/src/host/spawn.ts#L527-L548) - every `session/inputNeededSet` fires `input_needed_set` with its kind"
  - "[code://packages/sdk/src/types/events.ts#L97-L115](../../../../packages/sdk/src/types/events.ts#L97-L115) - `InputNeededSetEvent`, whose doc says a session is waiting"
  - "[code://packages/sdk/src/types/agent.ts#L196-L216](../../../../packages/sdk/src/types/agent.ts#L196-L216) - `Start.toolsServer`"
  - "[code://packages/sdk/test/host-tools.test.ts#L527-L753](../../../../packages/sdk/test/host-tools.test.ts#L527-L753) - the client-tool cases through the host, to extend"
  - "[code://packages/sdk/test/toolserver.test.ts](../../../../packages/sdk/test/toolserver.test.ts) - the tool server's cases, to extend"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `SessionToolClientExecutionRequest` (`channels-session/state.ts:370-404`); `awaitsUser` (`channels-session/reducer.ts:40-49`); a server MAY time a client call out with `success: false` (`channels-chat/actions.ts:309-318`)"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/chatContributions/sessionInputNeeded/sessionInputNeededContribution.ts#L218-L220 - the entry id is `toolClientExecution:<chat>:<turn>:<call>`"
  - "[code://packages/sdk/src/host/chatactions.ts#L1072-L1100](../../../../packages/sdk/src/host/chatactions.ts#L1072-L1100) - a client's `chat/toolCallComplete` is read down to its text blocks"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/claude/clientTools/claudeClientToolResult.ts#L35-L83 - `convertToolCallResult`: protocol content to MCP content, an image as an image, any other embedded resource as a resource blob, the rest as text"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1544-L1575 - a call failed for a client that left says when another active client provides the same tool"
---

## Goal

One sdk module holds a call a client runs: it raises the protocol's `toolClientExecution` entry, waits for the owning client, keeps an answer that arrives first, fails the call when the client leaves or the time runs out, and answers the four `Session` members.
A client's answer carries its whole content, not only its text.
The tool server runs a client's tool through a runner the backend gives it, answers with MCP content, serves the tools the session has now, and can tell an agent the list changed.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "byClient|waiting|releaseCalls" packages/agent-*/src` - three copies of one map: claude `clienttools.ts`, pi `session.ts`, cofold `turnagent.ts`.
- `rg -n "inputNeeded" packages/sdk/src` - the host passes the action through and fires the event; it computes no status from it.

### Runtime path

```
backend reports the call running -> holder.open(entry) -> emit session/inputNeededSet
harness runs the tool -> holder.wait(id) -> client chat/toolCallComplete -> Session.completeToolCall -> holder.complete
  -> the wait resolves -> holder emits session/inputNeededRemoved
ACP: agent -> MCP tools/call -> tool server -> runClient(tool, input, meta) -> backend -> holder.wait(id)
```

### Gaps

- `Not found: a client call timeout - searched timeout, setTimeout in the three backends.`
- `Not found: toolClientExecution - searched packages.`

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| - | None. | - |

| What | Source | Task |
| --- | --- | --- |
| The entry is the protocol's: `id`, `kind: toolClientExecution`, `chat`, `turnId`, `clientId`, and the call as a `ToolCallRunningState` | AHP 1.0.0 `channels-session/state.ts:370-404` | 01 |
| The entry id is `toolClientExecution:<chat>:<turn>:<call>` | VS Code `sessionInputNeededContribution.ts:218-220` | 01 |
| A call failed for a client that left says so, and names the other client's tool when one provides the same name | VS Code `protocolServerHandler.ts:1544-1575`; cofold's message | 01 |
| A call nobody answers fails with `ok: false` | AHP 1.0.0 `channels-chat/actions.ts:309-318` | 01, 03 |
| The tool server runs a client's tool instead of refusing it | the request, 2026-10-06 | 02 |
| The shared module raises and removes the entry, and the host stays a router | the parent's row, Softov, 2026-10-06: "The shared module" | 01 |
| 10 minutes, `clientToolTimeoutMs`, 0 is no limit | the parent's row, Softov, 2026-10-06: "10 min, configurable" | 01, 03 |
| A client's answer carries its content blocks, and the tool server answers them as MCP content, an image as an image and another embedded resource as a resource | the parent's row, Softov, 2026-10-06: "Everything now"; VS Code `claudeClientToolResult.ts:35-83` | 01, 02, 03 |
| The tool server can send `notifications/tools/list_changed` when a session's tools change, for the ACP option p4 adds | p4's rows, Softov, 2026-10-06: "configurable if possible" | 02 |

## Proposed architecture

- **Data flow** - `createClientCalls({ emit, timeoutMs })`, whose answer is `{ ok, text, content }` with `content` the protocol's `ToolResultContent[]`, returns `open`, `wait`, `complete`, `owner`, `gone`, `release` and `entries`; a backend spreads its `methods` (`toolCallOwner`, `completeToolCall`, `clientGone`) onto its `Session`.
- **Event flow** - `open` emits `session/inputNeededSet`; every end (`complete`, `gone`, `release`, the timer) emits `session/inputNeededRemoved` once.
- **State flow** - `entries()` is what the backend puts in its snapshot's `inputNeeded`.
- **Layer responsibilities** - sdk: the holder and the tool server's runner · backends: when to `open` and when to `wait`, in p2-p4.
- **Source-of-truth files** - `CREATE: packages/sdk/src/clientcalls.ts`, [`code://packages/sdk/src/toolserver.ts`](../../../../packages/sdk/src/toolserver.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A client call is held in one place](task-01-a-client-call-is-held-in-one-place.md) | todo | - |
| [02 - The tool server runs a client's tool and serves the tools the session has now](task-02-the-tool-server-runs-a-clients-tool.md) | todo | 01 |
| [03 - The host carries a client call end to end](task-03-the-host-carries-a-client-call-end-to-end.md) | todo | 01 |

## Risks and tradeoffs

- A holder that emits on `open` and a backend that also sets `InputNeeded` on its status would make delegated work read as a question - task 01 emits only the entry, and task 03 checks the session status through the protocol's reducer.
- A plugin listening to `input_needed_set` would hear delegated work - the event carries `kind`, and task 03 says in its doc that `toolClientExecution` is not a person being asked.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-client-call-is-held-in-one-place.md](task-01-a-client-call-is-held-in-one-place.md).
- **Open questions:** none.
- **Watch out for:** an answer can come back before the harness asks for it, because the client starts at `running`; `complete` on an opened call nobody waits on yet keeps the answer for `wait`.

## Final verification checklist

- [ ] `vitest run packages/sdk/test/clientcalls.test.ts packages/sdk/test/toolserver.test.ts packages/sdk/test/host-tools.test.ts` green.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.
- [ ] `plans/index.md` updated.
