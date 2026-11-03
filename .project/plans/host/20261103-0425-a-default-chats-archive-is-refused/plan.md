---
title: A default chat's archive is refused
domain: host
status: built
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://cde4dd6c - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/actions.ts#L876-L888 - the specification's text: archiving the default chat is equivalent to archiving the session, and SHOULD use `session/isArchivedChanged`"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L13453-L13464 - the reference host refuses an archive of a default chat"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L12120-L12122 - and refuses one in a session it has not loaded, without restoring it"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3369-L3374 - a session's read and archived bits are the session's, not a chat's"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts#L7838-L7856 - the window archives any chat of a session on the chat's channel, the default one included"
  - "[code://packages/sdk/src/host/chatactions.ts#L13-L70](../../../../packages/sdk/src/host/chatactions.ts#L13-L70) - `sessionFlag`, which moves the default chat's archived bit with the session's"
  - "[code://packages/sdk/src/host/chatactions.ts#L246-L300](../../../../packages/sdk/src/host/chatactions.ts#L246-L300) - the chat flag block, which archives the session with its default chat"
  - "[code://packages/sdk/test/host-snapshots.test.ts#L929-L997](../../../../packages/sdk/test/host-snapshots.test.ts#L929-L997) - the case of the default chat's archive"
  - "[code://packages/sdk/test/session-sleep.test.ts#L365-L376](../../../../packages/sdk/test/session-sleep.test.ts#L365-L376) - a session archived through its default chat sleeps"
---

## Goal

A `chat/isArchivedChanged` on a session's default chat is refused, as VS Code's host refuses it.
A session's archived bit is the session's alone, and no chat's bit moves with it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "defaultChat === channel" packages/sdk/src/host` - the chat flag block archives the session with its default chat.
- `rg -n "chatFlag\(ctx, uri, lead" packages/sdk/src/host` - `sessionFlag` moves the default chat's archived bit with the session's.
- VS Code at `a4e689ae`: `UNMANAGEABLE_CHAT_ARCHIVE_REJECTION` at agentService.ts L372, used at L13463 and L12551.

### Runtime path

```
chat/isArchivedChanged on the default chat -> actions.ts -> chatAction's flag block -> refused, nothing woken
session/isArchivedChanged -> actions.ts flag() -> sessionFlag -> the session's bit alone
```

### Gaps

- An archive of the default chat archives the session, where the reference host refuses it.
- A session's archive says `chat/isArchivedChanged` on its default chat, which the reference host never says.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The specification's text makes the default chat's archive "equivalent to archiving the session", and says a client "SHOULD use `session/isArchivedChanged` instead" | [actions.ts#L876-L888](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/actions.ts#L876-L888) | 01 |
| VS Code's host refuses it: `if (action.type === ActionType.ChatIsArchivedChanged && (owner === undefined \|\| this._chatOwnership.isDefaultChat(owner, channel) \|\| chatOrigin?.kind === ChatOriginKind.Tool))`, with "Only a known independently manageable non-default chat can be archived." | [agentService.ts#L13453-L13464](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L13453-L13464); [agentService.ts#L372](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L372) | 01 |
| VS Code's window sends that archive: `_setChatArchived` dispatches `ChatIsArchivedChanged` for any chat the session lists, so a VS Code client sees the refusal, and VS Code's host decides | [baseAgentHostSessionsProvider.ts#L7838-L7856](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts#L7838-L7856) | 01 |
| A session it has not loaded is refused the same way, as `'unmanageable'`, before any restore | [agentService.ts#L12120-L12122](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L12120-L12122); [agentService.ts#L12545-L12551](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L12545-L12551) | 01 |
| A session's flags "are owned by the session, not the chat", so a session's archive moves no chat's bit | [agentHostStateManager.ts#L3369-L3374](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3369-L3374) | 01 |

## Proposed architecture

- **State flow** - a session's archived bit is kept for the session alone; a default chat keeps no archived bit of its own making.
- **Layer responsibilities** - sdk: the chat flag block and `sessionFlag`.
- **Source-of-truth files** - [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The default chat's archive is refused](task-01-the-default-chats-archive-is-refused.md) | done | - |

## Risks and tradeoffs

- A store written while a session's archive moved its default chat's bit keeps that bit, and no action clears it.

## Resume state

- **Done so far:** task 01, 2026-11-03.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** a session not running names its default chat from its record, or from its catalogue row.

## Final verification checklist

- [x] The changed cases fail on `cde4dd6c` for the reasons they name, and pass after the change.
- [x] The snapshot, sleep, catalogue, sessions, merged and worktree test files pass.
- [x] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
