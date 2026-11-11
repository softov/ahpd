---
title: The session context tells each call and each cut reply
domain: host
status: planned
priority: medium
created: 2026-11-11
revalidated: 2026-11-11
requires: []
refs:
  - git://ca131f13d - the commit of ahpd this plan was checked at
  - git://e9abb18ab - the last commit whose `briefs/mcp-client.md` holds *get_session_context fields* and *No status on a tool call*, which this plan covers
  - "[code://.project/briefs/mcp-client.md](../../../briefs/mcp-client.md) - the brief, which keeps the items this plan leaves out"
  - "[code://packages/sdk/src/tools/session.ts#L221-L226](../../../../packages/sdk/src/tools/session.ts#L221-L226) - `CAPS`, the cuts per level of detail"
  - "[code://packages/sdk/src/tools/session.ts#L242-L295](../../../../packages/sdk/src/tools/session.ts#L242-L295) - `serializeContext`, which answers no `assistantTruncated`, `responseTurnId`, `messagesSentByMe` or `harness`, and a bare name per call"
  - "[code://packages/sdk/src/tools/session.ts#L990-L1027](../../../../packages/sdk/src/tools/session.ts#L990-L1027) - `get_session_context`, which takes no `responseTurnId` or `responseOffset`"
  - "[code://packages/sdk/src/tools/session.ts#L296-L324](../../../../packages/sdk/src/tools/session.ts#L296-L324) - `delegated`, the message meta that names who sent a message"
  - "[code://packages/sdk/src/types/host.ts#L1692](../../../../packages/sdk/src/types/host.ts#L1692) - `context(session, chatId)`, which answers no pending messages"
  - "[code://UPSTREAM.md#L25](../../../../UPSTREAM.md#L25) - the item that says `get_session_context` returns the caller's pending messages"
  - https://github.com/microsoft/vscode/blob/a1a15017f8a/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L275-L279 - `detail`, `responseTurnId` and `responseOffset`
  - https://github.com/microsoft/vscode/blob/a1a15017f8a/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L1876-L1965 - `serializeSessionContext`
  - https://github.com/microsoft/vscode/blob/a1a15017f8a/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L1966-L2001 - the page of one cut reply
  - https://github.com/microsoft/agent-host-protocol/blob/2c37a04f/types/channels-chat/state.ts#L1223-L1236 - `ToolCallStatus`, the words a call's `status` takes
  - https://github.com/microsoft/agent-host-protocol/blob/2c37a04f/types/channels-chat/state.ts#L1599-L1617 - a completed call's result and a cancelled call's `reason`
---

## Goal

A client that reads a session's context sees which replies were cut and can read each one whole, page by page.
It sees the messages it sent that still wait, and the agent of a chat that runs another one.
Each tool call says what happened to it.
A client tells a refused call from one that ran, and a failed one from one that worked.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "messagesSentByMe|assistantTruncated|responseTurnId|harness" packages/sdk/src/tools/session.ts` - none of the four is in ahpd.
- In VS Code at `a1a15017f8a`, `sed -n 1876,1965p sessionServerTools.ts` - the four fields and a call serialized as a name or `{ name, input }`, with no status.
- `rg -n "ToolCallStatus" types/channels-chat/state.ts` in agent-host-protocol - a call's status is one of eight words, and a completed call carries `success`.

### Runtime path

```
get_session_context { session, detail, transcriptLimit } -> at.context -> serializeContext -> transcript, messagesSentByMe, harness
get_session_context { session, responseTurnId, responseOffset } -> at.context -> one turn's reply, 8000 characters a page
```

### Gaps

- `Not found: where a chat that runs another agent than its session keeps that agent - searched ChatSummary and the session record for provider.` Task 01 serves `harness` only where the host knows one.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A cut reply carries `assistantTruncated: true` and its `responseTurnId` | Softov, 2026-11-11, chose to plan *get_session_context fields*; VS Code's `serializeSessionContext` | 01 |
| `responseTurnId` with `responseOffset` reads one turn's whole reply in pages of 8000 characters, with `nextResponseOffset` | VS Code's `applyGetSessionContextTool` | 01 |
| `messagesSentByMe` lists the calling chat's own pending messages, with `messageId`, `revision`, `delivery`, `status` and `message` | VS Code's `serializeSessionContext` | 01 |
| A caller with no session gets no `messagesSentByMe` | (defaulted: who owns a message sent from `/mcp` is the brief's *The session tools at /mcp* item, which this plan leaves out) | 01 |
| `harness` names the agent of a chat that runs another agent than its session | VS Code's `serializeSessionContext` | 01 |
| A turn's markdown parts stay joined with no space | the brief: VS Code joins them with `''` | 01 |
| Each call is an object at `digest` and `full`: `{ name, status }`, with `ok` for a completed call, `reason` for a cancelled one, and `error` for a failed one; `full` adds `input` | Softov, 2026-11-11, chose "Every call becomes an object" | 02 |
| `status` is the protocol's own word, such as `completed` or `cancelled` | (defaulted: one word per thing, and the protocol names it) | 02 |
| `error` is cut to 200 characters at both levels | (defaulted: the cut `full` already gives a call's input) | 02 |
| Each description is VS Code's words, with one sentence added for the call's status | Softov, 2026-11-10, chose "VS Code's words" for the session tools | 01, 02 |

## Proposed architecture

- **Data flow** - `context` also answers the chat's pending messages. `serializeContext` adds the four fields and a call's status from what each turn already holds.
- **Layer responsibilities** - sdk: `tools/session.ts` and the tools' host. docs: `docs/sdk/TOOLS.md` and `docs/server/MCP.md`.
- **Source-of-truth files** - [`code://packages/sdk/src/tools/session.ts`](../../../../packages/sdk/src/tools/session.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The context answers VS Code's fields](task-01-the-context-answers-vscodes-fields.md) | todo | - |
| [02 - Each tool call says its status](task-02-each-tool-call-says-its-status.md) | todo | 01 |

## Risks and tradeoffs

- A client that reads a call at `digest` as a bare name gets an object - the release notes say so under *Upgrading*.
- A sessionless caller still cannot see its own pending messages - the brief's ownership item fixes it, and this plan's tests pin today's answer.

## Resume state

- **Done so far:** the plan, 2026-11-11.
- **Next action:** [task-01-the-context-answers-vscodes-fields.md](task-01-the-context-answers-vscodes-fields.md).
- **Open questions:** none.
- **Watch out for:**
`responseTurnId` reads a completed turn only; VS Code refuses an id it cannot find with its own sentence.
`assistantTruncated` compares the reply's whole length with the cap, not the cut text, as VS Code does.

## Final verification checklist

- [ ] A reply longer than its cap carries `assistantTruncated` and a `responseTurnId`, and its pages add up to the whole reply.
- [ ] A chat's pending queued message shows in `messagesSentByMe` for the chat that sent it.
- [ ] A denied call reads `status: "cancelled"` with `reason: "denied"`, and a call that ran reads `status: "completed"` with `ok`.
- [ ] `pnpm typecheck` passes, and the sdk and server suites pass, one at a time.
