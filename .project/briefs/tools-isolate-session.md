---
title: An agent moves its chat to a new worktree
created: 2026-11-06
refs:
  - git://f48055f0 - the commit of ahpd the facts were checked at
  - "[code://packages/sdk/src/tools/session.ts#L459-L494](../../packages/sdk/src/tools/session.ts#L459-L494) - `set_workspace`, the sibling tool that asks for a move at the turn's end"
  - "[code://packages/sdk/src/host/tooling.ts#L1888-L1904](../../packages/sdk/src/host/tooling.ts#L1888-L1904) - `setWorkspace`, which keeps the move until the turn ends"
  - "[code://packages/sdk/src/host/spawn.ts#L1501-L1511](../../packages/sdk/src/host/spawn.ts#L1501-L1511) - the move is made when the asking turn ends"
  - "[code://packages/sdk/src/host/lifecycle.ts#L934-L995](../../packages/sdk/src/host/lifecycle.ts#L934-L995) - `moveSession`, which restarts the whole session and starts the continuation turn"
  - "[code://packages/sdk/src/host/lifecycle.ts#L997-L1005](../../packages/sdk/src/host/lifecycle.ts#L997-L1005) - `restartChat`, which starts one chat again in the folders it now has"
  - "[code://packages/sdk/src/host/chatactions.ts#L1491-L1503](../../packages/sdk/src/host/chatactions.ts#L1491-L1503) - `chat/workingDirectorySet`, refused for an agent with one folder per session"
  - "[code://packages/sdk/src/host/root.ts#L339-L341](../../packages/sdk/src/host/root.ts#L339-L341) - `multipleWorkingDirectories`, advertised for an agent with `multipleDirectories`"
  - https://github.com/microsoft/vscode/blob/1.143.1/src/vs/platform/agentHost/node/shared/sessionIsolationTools.ts - VS Code's `isolate_session`, at 1.143.1
  - https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/state.ts#L85-L98 - a chat's own `workingDirectories`, a subset of its session's
---

# An agent moves its chat to a new worktree

Softov wants ahpd to serve VS Code's `isolate_session` tool.
An agent calls it to go on with a task in a new git worktree, and leaves its current checkout as it is.
Softov also reviews the tool's text before it is copied.

## What others do

VS Code 1.143.1 serves `isolate_session` in its own tool group, `createSessionIsolationToolGroup`.

- It takes no input. Any input is refused.
- It moves only the current chat to a new worktree. Other chats, even in the same folder, stay where they are.
- The session's folders gain the new worktree. The original folder does not change.
- Uncommitted edits are not copied, except the worktree include-files the person configured.
- It needs a chat that works in one local git folder, and an active turn.
- It is offered only where the provider supports chat isolation, and only to a top-level chat, not to a subagent.
- It always asks the person first, with the title "Change Workspace?".
- The tool asks for the move and returns. The host moves the chat after the turn, and starts a turn that continues the task.

## What ahpd has today

- No `isolate_session` tool.
- `set_workspace` asks for a move with `isolation: true` to get a worktree. The move is made when the turn ends, and a continuation turn follows.
- That move restarts the whole session in the new folder: every chat moves.
- `restartChat` starts one chat again in its own folders, so one chat can move without the others.
- ahpd keeps a chat's own folders through `chat/workingDirectorySet`, for an agent with `multipleDirectories`. Claude has it; pi does not.

## The text of the tool

VS Code's description is 681 characters, with no inputs.
It says what moves, what does not, what is copied, what it needs, and to end the turn after it.
The confirmation text the person reads is a second text, 184 characters.

## Who writes

- No branch on `origin` or `maycxc` ahead of `f48055f0` changes `packages/sdk/src/tools/` after 2026-11-02. `maycxc/union` has no commit ahead of main.
- ahpw and ahpc draw a session's folders. A chat that has a folder its session's other chats do not have is new to them.

## The change

- ahpd serves `isolate_session`, under VS Code's name, with no input.
- The tool moves the calling chat to a new worktree when its turn ends, and leaves the other chats where they are.
- The session's folders gain the worktree, and a continuation turn tells the chat where it now is.
- The tool is offered only to a top-level chat of an agent with `multipleDirectories`.
- The tool asks the person first.
- `docs/sdk/TOOLS.md` names the tool.

## Open points

- Whether `set_workspace` moves one chat too, which the session tools brief asks: [tools-sessions.md](tools-sessions.md).
- Which files are copied into the new worktree. VS Code copies the worktree include-files; ahpd has no such setting yet.
- For the text review: keep VS Code's words, or write shorter text of ahpd's own.
