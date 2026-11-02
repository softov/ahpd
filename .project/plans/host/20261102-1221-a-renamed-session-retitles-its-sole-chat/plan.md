---
title: A renamed session retitles its sole chat
domain: host
status: planned
priority: high
created: 2026-11-02
revalidated: 2026-11-02
requires:
  - plans/host/20261102-1142-a-renamed-chat-keeps-its-new-title/plan.md
  - plans/host/20261102-1050-a-sessions-read-state-follows-its-chats/plan.md
refs:
  - git://b91d615e - the commit of ahpd this plan was checked at, a renamed chat's line with the read state's merged in
  - "https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/chatContributions/sessionTitle/sessionTitleContribution.ts#L74-L100 - a rename on the session's channel retitles the default chat of a session with one counted chat"
  - "https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/common/state/sessionState.ts#L2063-L2070 - the chats counted, every chat but a tool's and a hidden one"
  - "https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2316-L2331 - `updateChatTitle` sets the chat's held title and says its row"
  - "https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts#L8092-L8103 - the Sessions window renames a session on the session's own channel"
  - "https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts#L2149 - it reads a tab's title from the default chat's row"
  - "[code://packages/sdk/src/host/tooling.ts#L1348-L1364](../../../../packages/sdk/src/host/tooling.ts#L1348-L1364) - `renameSession`, which leaves the default chat's held title and its row"
  - "[code://packages/sdk/src/host/tooling.ts#L1331-L1347](../../../../packages/sdk/src/host/tooling.ts#L1331-L1347) - `renameChat`, which sets a chat's held title and says its row"
  - "[code://packages/sdk/src/host/chatactions.ts#L112-L140](../../../../packages/sdk/src/host/chatactions.ts#L112-L140) - `readAggregate`, the chats a session counts"
---

## Goal

A client that renames a session on the session's own channel renames its default chat too, when the session counts one chat.
The default chat's held title and its row in the session take the new title, as VS Code's host carries a session's rename down.
The Sessions window reads a tab's title from that row, so its tab then shows the new title.
A session with peer chats keeps its default chat's held title and row.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "renameSession|renameChat" packages/sdk/src/host` - one `renameSession`, reached from a rename on the session's channel.
- `renameSession` hands the default chat's backend the title, stores it, and says `session/titleChanged`.
- It leaves the default chat's held state, so that chat's row keeps its old title.
- `readAggregate` returns the chats a session counts: every open chat but a tool's, a worker's and a hidden one.
- VS Code main at `a1254744` says the client's action, then retitles a sole counted chat through `updateChatTitle`.
- Its files read here hash equal to the ones at `37eba093`, so the lines hold at both.

### Runtime path

```
client session/titleChanged on a session channel -> chatactions.ts -> renameSession
  -> backend title, store -> session/titleChanged
  -> with one counted chat: the default chat's held title -> session/chatUpdated
```

### Gaps

- A session renamed on its own channel keeps its default chat's old title in that chat's held state and its row.
- The Sessions window reads a tab's title from that row, so a single-chat session's tab shows the old title.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A rename on the session's channel retitles the default chat when the session counts one chat or none | [sessionTitleContribution.ts#L86-L95](https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/chatContributions/sessionTitle/sessionTitleContribution.ts#L86-L95) | 01 |
| The chats counted are the ones `readAggregate` returns | [sessionState.ts#L2063-L2070](https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/common/state/sessionState.ts#L2063-L2070); [code://packages/sdk/src/host/chatactions.ts#L112-L140](../../../../packages/sdk/src/host/chatactions.ts#L112-L140) | 01 |
| The default chat's held title moves and its row says it with this host's `session/chatUpdated`, after `session/titleChanged` | [agentHostStateManager.ts#L2316-L2331](https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2316-L2331) | 01 |
| `renameChat` and `renameSession` share the step that sets a chat's held title and says its row | [code://packages/sdk/src/host/tooling.ts#L1339-L1341](../../../../packages/sdk/src/host/tooling.ts#L1339-L1341) | 01 |
| A session with peer chats keeps its default chat's held title and row | [sessionTitleContribution.ts#L80-L90](https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/chatContributions/sessionTitle/sessionTitleContribution.ts#L80-L90) | 01 |
| `AHP.md` says what a rename on the session's channel moves | [code://docs/sdk/AHP.md#L235](../../../../docs/sdk/AHP.md#L235) | 01 |

## Proposed architecture

- **Event flow** - `session/titleChanged` answers the client's rename, then the sole chat's row says the title with `session/chatUpdated`.
- **State flow** - the default chat's held state takes the title, and every row read off it after says the same.
- **Layer responsibilities** - `renameSession` renames a session; `updateChatTitle` sets a chat's held title and says its row.
- **Source-of-truth files** - [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The sole chat takes the session's title](task-01-the-sole-chat-takes-the-sessions-title.md) | todo | - |

## Risks and tradeoffs

- A client watching the default chat's own channel holds the old title until it subscribes again, since no chat action carries a title.
- VS Code's host leaves such a client with the old title too.
- This host keeps a session's title under its default chat, so with peer chats the store and the backend take the session's title.
- VS Code's host keeps a session's title apart from its default chat's, so a restored session with peer chats differs from it there.

## Resume state

- **Done so far:** planned 2026-11-02.
- **Next action:** [task-01-the-sole-chat-takes-the-sessions-title.md](task-01-the-sole-chat-takes-the-sessions-title.md).
- **Open questions:** none.
- **Watch out for:** `readAggregate` reads a sleeping session's recorded chats, and `renameSession` runs on a session that is running.

## Final verification checklist

- [ ] Each new case fails on `b91d615e` for the reason it names, and passes after the change.
- [ ] The touched suites pass.
- [ ] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
