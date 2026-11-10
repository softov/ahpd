---
title: An agent isolates its chat in a new worktree
domain: host
status: planned
priority: medium
created: 2026-11-10
revalidated: 2026-11-10
requires:
  - plans/host/20261110-0813-the-session-tools-follow-vscode/plan.md
changes: []
creates: []
refs:
  - git://7d76d5895 - the commit of ahpd this plan was checked at
  - git://e388d12f5:.project/briefs/tools-isolate-session.md - the brief this plan covers
  - "[code://packages/sdk/src/host/tooling.ts#L2086](../../../../packages/sdk/src/host/tooling.ts#L2086) - `setWorkspace`, which keeps a move until the turn ends; the one-chat move is host/20261110-0813-the-session-tools-follow-vscode task 02"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1468](../../../../packages/sdk/src/host/lifecycle.ts#L1468) - the session's `worktreeIncludeFiles`, the files a new worktree gets"
  - "[code://packages/sdk/src/host/root.ts#L362](../../../../packages/sdk/src/host/root.ts#L362) - `multipleWorkingDirectories`, for an agent with `multipleDirectories`"
  - "[code://packages/sdk/src/tools/session.ts#L406](../../../../packages/sdk/src/tools/session.ts#L406) - `sessionTools`"
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/shared/sessionIsolationTools.ts - VS Code's `isolate_session` at 171e90619
---

## Goal

An agent goes on with its task in a new git worktree and leaves its checkout as it is.
It calls `isolate_session`, the person confirms, and at the turn's end the calling chat moves to the new worktree and a turn continues the task.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `git grep -n isolate_session -- packages` - none.
- `grep -n worktreeIncludeFiles packages/sdk/src/host` - ahpd has the setting; the brief said it had none.

### Runtime path

```
isolate_session -> confirmation "Change Workspace?" -> setWorkspace(chat, worktree) -> turn end
  -> new worktree with worktreeIncludeFiles -> restartChat -> continuation turn
```

### Gaps

- None beyond what the required plan builds.

## Answers

| What | Source | Task |
| --- | --- | --- |
| ahpd serves `isolate_session` under VS Code's name, with no input | the brief | 01 |
| Each text is VS Code's, the confirmation included | Softov, 2026-11-10, chose "VS Code's words" | 01 |
| VS Code's main at 171e90619 is the reference | Softov, 2026-11-10, chose "VS Code's newer main" | 01 |
| Only the calling chat moves | the brief; VS Code's tool | 01 |
| The new worktree gets the session's `worktreeIncludeFiles` | (defaulted: VS Code copies its include-files, and ahpd has the same setting) | 01 |
| The tool is offered only to a top-level chat of an agent with `multipleDirectories` | the brief; VS Code offers it where the provider isolates a chat | 01 |

## Proposed architecture

- **Data flow** - the tool asks, then keeps a move with a new worktree for the calling chat.
- **Event flow** - the confirmation, then the move's actions at the turn's end.
- **State flow** - the session's folders gain the worktree.
- **Layer responsibilities** - sdk: `tools/session.ts` and the host's move. docs: `TOOLS.md`.
- **Source-of-truth files** - [`code://packages/sdk/src/tools/session.ts`](../../../../packages/sdk/src/tools/session.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - isolate_session moves the chat to a worktree](task-01-isolate-session.md) | todo | - |

## Risks and tradeoffs

- pi has no `multipleDirectories`, so a pi agent is not offered the tool.

## Resume state

- **Done so far:** planned 2026-11-10.
- **Next action:** [task-01-isolate-session.md](task-01-isolate-session.md), once the required plan's task 02 is built.
- **Open questions:** none.
- **Watch out for:** VS Code refuses any input; a call with one is refused in its words.

## Final verification checklist

- [ ] A Claude chat calls `isolate_session`, the person confirms, and the chat continues in a new worktree.
- [ ] The session's other chats keep their folders.
- [ ] The worktree holds the session's `worktreeIncludeFiles`.
- [ ] A pi agent and a subagent are not offered the tool.
- [ ] `pnpm typecheck` and the sdk suite pass, and Windows CI is green.
