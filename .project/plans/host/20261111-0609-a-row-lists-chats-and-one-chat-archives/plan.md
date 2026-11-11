---
title: A session row lists its chats, and one chat archives
domain: host
status: planned
priority: medium
created: 2026-11-11
revalidated: 2026-11-11
requires: []
refs:
  - git://ca131f13d - the commit of ahpd this plan was checked at
  - git://e9abb18ab - the last commit whose `briefs/mcp-client.md` holds *No chats on a row* and *No tool archives one chat*, which this plan covers
  - "[code://.project/briefs/mcp-client.md](../../../briefs/mcp-client.md) - the brief, which keeps the items this plan leaves out"
  - "[code://packages/sdk/src/tools/session.ts#L105-L140](../../../../packages/sdk/src/tools/session.ts#L105-L140) - `serializeSession`, the `list_sessions` row, which leaves out the row's `chats`"
  - "[code://packages/sdk/src/tools/session.ts#L535-L567](../../../../packages/sdk/src/tools/session.ts#L535-L567) - `list_sessions`, whose description gets VS Code's sentence on `chats`"
  - "[code://packages/sdk/src/tools/session.ts#L1029-L1053](../../../../packages/sdk/src/tools/session.ts#L1029-L1053) - `delete_session`, the shape `archive_chat` copies"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1194](../../../../packages/sdk/src/host/sessionmethods.ts#L1194) - a catalogue row already carries `chats`, cut to the chats a connection is shown"
  - "[code://packages/sdk/src/host/chatactions.ts#L112-L128](../../../../packages/sdk/src/host/chatactions.ts#L112-L128) - `chatFlag`, which archives one chat with `chat/isArchivedChanged`"
  - "[code://packages/sdk/src/host/actions.ts#L955-L975](../../../../packages/sdk/src/host/actions.ts#L955-L975) - `chat/isArchivedChanged` on a session's default chat archives the session"
  - "[code://packages/sdk/src/host/gate.ts#L163](../../../../packages/sdk/src/host/gate.ts#L163) - `session/isArchivedChanged` needs `session:mark`"
  - "[code://packages/sdk/src/host/gate.ts#L183](../../../../packages/sdk/src/host/gate.ts#L183) - `chat/isArchivedChanged` needs `chat:mark`"
  - "[code://packages/sdk/src/types/host.ts#L1659](../../../../packages/sdk/src/types/host.ts#L1659) - `chats(session)` on the tools' host, a running session's chats only"
  - "[code://UPSTREAM.md#L29](../../../../UPSTREAM.md#L29) - `archive_chat`, open with no plan, which task 02 closes"
  - https://github.com/microsoft/vscode/blob/a1a15017f8a/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L187 - the sentence that tells a client about `chats`
  - https://github.com/microsoft/vscode/blob/a1a15017f8a/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L611-L644 - `ISerializedSessionChat` and `serializeSessionChats`
  - https://github.com/microsoft/vscode/blob/a1a15017f8a/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L234-L240 - `archive_chat`'s input
  - https://github.com/microsoft/vscode/blob/a1a15017f8a/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L326-L333 - `archive_chat`'s description
  - https://github.com/microsoft/vscode/blob/a1a15017f8a/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L2045-L2096 - `getArchiveChatArgs`, its targets and its refusals
---

## Goal

A client finds every chat of a session from its `list_sessions` row, with a link it can pass to the other session tools.
A client archives one nested chat, or a whole session, with `archive_chat`, as VS Code's session tools do.
Both work from `/mcp`, so a person's MCP client can tidy what it started.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "chats" packages/sdk/src/tools/session.ts` - only `move_session`'s description and two link lookups name a chat list; no row serializes one.
- `rg -n "chat/isArchivedChanged" packages/sdk/src` - the host archives a chat and a session today; no tool sends either.
- `rg -n "isArchivedChanged" packages/sdk/src/host/gate.ts` - `chat:mark` and `session:mark` are the grants of the two actions.
- In VS Code at `a1a15017f8a`, `rg -n "ArchiveChat" sessionServerTools.ts` - one tool, one input `chat`, two targets.

### Runtime path

```
list_sessions -> at.sessions() -> Summary.chats -> serializeSession -> chats[] when a nested chat exists
archive_chat { chat } -> known(...) -> nested chat: chat/isArchivedChanged | main or session link: session/isArchivedChanged
```

### Gaps

- `Not found: where a chat that runs another agent than its session keeps that agent - searched ChatSummary and the session record for provider.` Task 01 serves `harness` only where the host knows one.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A row lists `chats` when its session has a nested chat: each with `title`, `openLink`, `main: true` for the default chat, `status` and `harness` | Softov, 2026-11-11, chose to plan *No chats on a row*; VS Code's `serializeSessionChats` | 01 |
| `chats` leaves out the chats of a tool and the hidden chats | (defaulted: VS Code leaves them out, as they are not sessions of their own) | 01 |
| A session that is not running lists its chats from its row, not from a running backend | (defaulted: `at.chats` answers a running session only, and a row already carries its `chats`) | 01 |
| `archive_chat` takes `chat`: a nested chat archives that chat, and the default chat or a session link archives the whole session | Softov, 2026-11-11, chose to plan *No tool archives one chat*; VS Code's `getArchiveChatArgs` | 02 |
| `archive_chat` refuses the chat it runs in, and the default chat of its own session | VS Code's `getArchiveChatArgs` | 02 |
| `archive_chat` is served at `/mcp` | (defaulted: the brief's goal is that a person's MCP client can use every session tool it needs) | 02 |
| A chat needs `chat:mark`, and a session needs `session:mark` | (defaulted: the grants the host's gate has for the two actions) | 02 |
| An archive does what the host's archive does today, and nothing more | (defaulted: VS Code's tool calls its host's archive, so ahpd's calls ahpd's) | 02 |
| Each description and refusal is VS Code's words | Softov, 2026-11-10, chose "VS Code's words" for the session tools | 01, 02 |

## Proposed architecture

- **Data flow** - `list_sessions` reads the row's `chats`, which the catalogue already holds. `archive_chat` sends the archive action the host already has, through the same path a client's action takes.
- **Layer responsibilities** - sdk: `tools/session.ts` and the tools' host. docs: `docs/sdk/TOOLS.md` and `docs/server/MCP.md`.
- **Source-of-truth files** - [`code://packages/sdk/src/tools/session.ts`](../../../../packages/sdk/src/tools/session.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A row lists its chats](task-01-a-row-lists-its-chats.md) | todo | - |
| [02 - archive_chat archives one chat](task-02-archive-chat-archives-one-chat.md) | todo | 01 |

## Risks and tradeoffs

- A row grows with each nested chat - `chats` is left out of a session that has only its default chat, as in VS Code.
- `archive_chat` on a session link archives all its chats - VS Code's description says so, and the tool refuses the caller's own session.

## Resume state

- **Done so far:** the plan, 2026-11-11.
- **Next action:** [task-01-a-row-lists-its-chats.md](task-01-a-row-lists-its-chats.md).
- **Open questions:** none.
- **Watch out for:**
`move_session`'s description already tells a client to read a nested chat's `openLink` from `chats`; task 01 makes that true.
A link to the default chat must resolve as the session itself, as `getArchiveChatArgs` does, or `archive_chat` archives a chat the host refuses.

## Final verification checklist

- [ ] A `list_sessions` row of a session with a nested chat lists both chats, the default one with `main: true`.
- [ ] `archive_chat` on a nested chat's link archives that chat alone, and the session stays listed.
- [ ] `archive_chat` on a session link archives the session.
- [ ] Both work from `/mcp`.
- [ ] `pnpm typecheck` passes, and the sdk and server suites pass, one at a time.
