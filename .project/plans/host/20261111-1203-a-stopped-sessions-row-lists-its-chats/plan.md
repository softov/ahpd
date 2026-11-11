---
title: A stopped session's row lists its chats
domain: host
status: planned
priority: high
created: 2026-11-11
revalidated: 2026-11-11
requires:
  - plans/host/20261111-0609-a-row-lists-chats-and-one-chat-archives/plan.md
changes: []
creates: []
refs:
  - git://442448876 - the head of `host/20261111-0609-a-row-lists-chats-and-one-chat-archives`, where the gap was found in review
  - "[code://packages/sdk/src/host/catalogue.ts#L1553-L1599](../../../../packages/sdk/src/host/catalogue.ts#L1553-L1599) - `registerListedSession`, the row of a session nothing runs, with no `chats` and no `defaultChat`"
  - "[code://packages/sdk/src/host/catalogue.ts#L560-L571](../../../../packages/sdk/src/host/catalogue.ts#L560-L571) - `toSessionSummaryChats`, the chats of a running session's row, the shape to copy"
  - "[code://packages/sdk/src/host/chatrecord.ts#L141-L151](../../../../packages/sdk/src/host/chatrecord.ts#L141-L151) - `recordedChats` and `sessionBackendId`, the chats the record keeps and its default"
  - "[code://packages/sdk/src/types/sessions.ts#L123-L180](../../../../packages/sdk/src/types/sessions.ts#L123-L180) - `StoredChat`: uri, title, provider and origin"
  - "[code://packages/sdk/src/host/chatactions.ts#L112-L139](../../../../packages/sdk/src/host/chatactions.ts#L112-L139) - `chatFlag`, which archives a chat whose session is not running"
  - https://github.com/microsoft/vscode/blob/1564f100807a/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1783 - `registerRestoredChatSummary`, VS Code's catalogue entry for a restored session's chat
  - "[code://packages/sdk/src/tools/session.ts#L44-L54](../../../../packages/sdk/src/tools/session.ts#L44-L54) - `sessionMeant`, which needs a link's agent to equal the row's provider"
  - https://github.com/microsoft/vscode/blob/1564f100807a/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L1335-L1341 - `resolveKnownSession`, which turns a link back into its session URI
  - git://37a8335f3 - the port of the session tools that added the agent check
---

## Goal

A `list_sessions` row of a session nothing runs lists its chats, as the row of a running one does.
A client finds a nested chat's link after a restart, and `archive_chat` archives that chat without starting the session.
A link finds its session by the id it carries, whatever agent it names.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- A test in review: a second host on the same store answered the session's row with no `chats`.
- `archive_chat` then refused the nested chat's link as `chat must target a known chat of its session`.
- `grep -n "chats" packages/sdk/src/host/catalogue.ts` - only a running session's summary sets `chats`, through `toSessionSummaryChats`.
- `~/.config/ahpd/sessions/<id>.json` - the record keeps `chats`, each with `uri`, `backendId` and `default`, and `chatFlags` per chat.

### Runtime path

```
listSessions() -> registerListedSession(row) -> Summary { ..., chats: recordedChats(id), defaultChat }
archive_chat { chat } -> at.chats(session) empty -> the row's chats -> chatFlag(session, chat, IsArchived)
```

### Gaps

- The plan this one requires answered that a stopped session lists its chats from its row. The row had none to list.
- A session is `ahp-session:/<id>`, and its link is `agent-host-session://<agent>/<id>`. The link does not turn back into the URI, so `sessionMeant` matches the id and checks the agent. A correct link was refused once on 2026-11-11.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A stopped session's row carries `chats` and `defaultChat` from its record | Softov, 2026-11-11: "do the plan to fix 'A gap in the chats build,' and build it" | 01 |
| Each chat carries `resource`, `title`, `origin`, `provider`, `status` and `archived`, as `toSessionSummaryChats` gives them | (defaulted: one shape for a row, running or not) | 01 |
| A chat's status is `Idle` with its own flags, as a running session's chat with no state reads | `code://packages/sdk/src/host/catalogue.ts#L514` | 01 |
| A chat the record marks closed, and a tool's chat, are left out | (defaulted: `recordedChats` drops the closed, and `toSessionSummaryChats` drops the tool's) | 01 |
| `archive_chat` reads the row's chats and default chat when the session runs nothing | (defaulted: `chatFlag` already archives a chat of a session nothing runs) | 02 |
| The work stacks on the branch of the plan this one requires | (defaulted: the two plans touch `archive_chat` in one file) | 01, 02, 03 |
| A link finds its session by its id alone; the agent it names does not refuse it | Softov, 2026-11-11, asked "we need to accept both link and the id?", then "I want it" | 03 |
| A session URI and a link stay two accepted inputs, as VS Code's tools take both | `resolveKnownSession` in VS Code | 03 |

## Proposed architecture

- **Data flow** - `registerListedSession` adds the record's chats to the row; `archive_chat` falls back to them.
- **Event flow** - none new: an archive dispatches `chat/isArchivedChanged` and `session/chatUpdated`, as now.
- **State flow** - nothing is written by a listing.
- **Layer responsibilities** - sdk host: the row. sdk tools: `archive_chat`.
- **Source-of-truth files** - [`code://packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A stopped row lists its chats](task-01-a-stopped-row-lists-its-chats.md) | implemented | - |
| [02 - archive_chat reads the row](task-02-archive-chat-reads-the-row.md) | implemented | 01 |
| [03 - A link finds its session by id](task-03-a-link-finds-its-session-by-id.md) | implemented | - |

## Risks and tradeoffs

- A listing reads every stopped session's record chats. They are in memory, so a listing asks the store no more questions.

## Resume state

- **Done so far:** tasks 01, 02 and 03 implemented 2026-11-11, on the branch of this plan.
- **Next action:** Softov's review, then `done` on each task.
- **Open questions:** none.
- **Watch out for:** the tool's `serializeChats` decides when a row shows `chats`, not the host.

## Final verification checklist

- [ ] After a restart, `list_sessions` lists a stopped session's nested chat with its link.
- [ ] `archive_chat` archives that chat, and the session stays stopped and unarchived.
- [ ] A link whose agent differs from the row's provider finds the session by its id.
- [ ] `pnpm typecheck`, and the sdk and server suites pass.
