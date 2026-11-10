---
title: The session tools follow VS Code's main
domain: host
status: planned
priority: medium
created: 2026-11-10
revalidated: 2026-11-10
requires: []
changes: []
creates: []
refs:
  - git://7d76d5895 - the commit of ahpd this plan was checked at
  - git://e388d12f5:.project/briefs/tools-sessions.md - the brief this plan covers, with the rest in host/20261110-0813-the-session-tools-find-and-list-agents
  - "[code://packages/sdk/src/tools/session.ts#L459-L505](../../../../packages/sdk/src/tools/session.ts#L459-L505) - `set_workspace`, which asks for a move of the whole session"
  - "[code://packages/sdk/src/tools/session.ts#L506-L585](../../../../packages/sdk/src/tools/session.ts#L506-L585) - `create_session`, which fails in a folder that is not a git repository"
  - "[code://packages/sdk/src/tools/session.ts#L682-L711](../../../../packages/sdk/src/tools/session.ts#L682-L711) - `send_message`, with `session` and `message` only"
  - "[code://packages/sdk/src/host/tooling.ts#L2086](../../../../packages/sdk/src/host/tooling.ts#L2086) - `setWorkspace`, which keeps the move until the turn ends"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1150](../../../../packages/sdk/src/host/lifecycle.ts#L1150) - `moveSession`, which restarts every chat in the new folder"
  - "[code://packages/sdk/src/host/lifecycle.ts](../../../../packages/sdk/src/host/lifecycle.ts) - `restartChat`, which starts one chat again in its own folders"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L190-L200](../../../../packages/sdk/src/host/sessionmethods.ts#L190-L200) - the host's `moveChat`, which `move_session` calls"
  - "[code://packages/sdk/src/host/root.ts#L362](../../../../packages/sdk/src/host/root.ts#L362) - `multipleWorkingDirectories`, for an agent with a folder per chat"
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/shared/sessionServerTools.ts - `set_workspace`, `send_message` and `create_session` at 171e90619
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/shared/sessionMoveTools.ts - `move_session` at 171e90619
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/shared/worktreeIsolation.ts - a folder that is not a git repository is used as it is
---

## Goal

The session tools do what VS Code's main does.
`send_message` can replace or cancel a queued message and steer a running turn.
`set_workspace` moves only the calling chat, `create_session` works in a folder with no git, and `move_session` reorganizes sessions.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `grep -n "relationship" packages/sdk/src/tools/session.ts` - `create_session` already has VS Code's main shape: `relationship`, `prompt` and `title` required.
- VS Code's `SessionServerToolName` at 171e90619 adds `isolate_session`, in host/20261110-0813-an-agent-isolates-its-chat, and `move_session`, here.

### Runtime path

```
send_message { operation, delivery } -> the chat's queue or steering -> a turn
set_workspace -> setWorkspace -> turn end -> restartChat of the calling chat -> continuation turn
move_session -> moveChat (chatMoves.enabled) -> session/chatRemoved, chatAdded
```

### Gaps

- A chat with folders of its own is new to ahpw and ahpc, which draw a session's folders.

## Answers

| What | Source | Task |
| --- | --- | --- |
| VS Code's main at 171e90619 is the reference | Softov, 2026-11-10, chose "VS Code's newer main" | 01-04 |
| Each text is VS Code's | Softov, 2026-11-10, chose "VS Code's words" | 01-04 |
| `set_workspace` moves the calling chat only; an agent with one folder per session moves the session as now | Softov, 2026-11-10, chose "Move the current chat only" | 02 |
| `send_message` takes `operation`, `delivery`, `messageId` and `expectedRevision` | the brief; VS Code's `send_message` | 01 |
| `create_session` uses a folder that is not a git repository as it is, when `worktree` is left out | the brief; VS Code's `worktreeIsolation.ts` | 03 |
| `move_session` is served over the host's `moveChat`, under `chatMoves.enabled` | (defaulted: the host already moves chats, as VS Code's tool does) | 04 |

## Proposed architecture

- **Data flow** - `send_message` reaches the chat's queue and steering; `set_workspace` reaches `restartChat`; `move_session` reaches `moveChat`.
- **Event flow** - the actions each path already sends.
- **State flow** - a moved chat keeps folders of its own in its session's record.
- **Layer responsibilities** - sdk: `tools/session.ts`, `host/tooling.ts`, `host/lifecycle.ts`. docs: `MCP.md` and `TOOLS.md`.
- **Source-of-truth files** - [`code://packages/sdk/src/tools/session.ts`](../../../../packages/sdk/src/tools/session.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - send_message replaces, cancels and steers](task-01-send-message-replaces-and-steers.md) | implemented | - |
| [02 - set_workspace moves the calling chat](task-02-set-workspace-moves-the-chat.md) | implemented | - |
| [03 - create_session works with no git](task-03-create-session-works-with-no-git.md) | implemented | - |
| [04 - move_session reorganizes sessions](task-04-move-session.md) | todo | - |

## Risks and tradeoffs

- A chat in a folder its session's other chats do not have may draw wrong in ahpw and ahpc. Each client is checked by hand after task 02.

## Resume state

- **Done so far:** task 01 implemented 2026-11-10; `send_message` takes `operation`, `delivery`, `messageId` and `expectedRevision`, and answers in VS Code's terms. Task 02 implemented 2026-11-10; `set_workspace` moves only the calling chat for an agent with `multipleDirectories`, and the session's folders gain the new one. Task 03 implemented 2026-11-10; `create_session` picks the folder a host offers for a directory with no git, and refuses `worktree: true` there.
- **Next action:** [task-04-move-session.md](task-04-move-session.md).
- **Open questions:** none.
- **Watch out for:** VS Code's main moved past ahpd's UPSTREAM.md checkpoint, 1.143.1. Add these tools to the next pass's notes, so the pass does not do them again. The prescribed sdk run leaves `watches.test.ts > honours the excludes it was given` failing while `TMPDIR` is inside the worktree: the case's own paths contain `node_modules/`. It passes with `TMPDIR` outside the repository.

## Final verification checklist

- [ ] `send_message` with `delivery: steer` steers a running turn; `replace` and `cancel` act on a queued message.
- [ ] `set_workspace` in one chat leaves the session's other chats where they were.
- [ ] `create_session` in a folder with no git makes the session there.
- [ ] `move_session` moves a chat into another session, and refuses while `chatMoves.enabled` is off.
- [ ] `pnpm typecheck` and the sdk and server suites pass, and Windows CI is green.
