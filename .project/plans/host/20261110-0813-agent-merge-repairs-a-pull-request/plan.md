---
title: Agent Merge repairs a pull request
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
  - git://e388d12f5:.project/briefs/tools-agent-merge.md - the brief this plan covers, with the merge in host/20261110-0813-agent-merge-merges-a-pull-request
  - "[code://packages/sdk/src/vscoderootconfig.ts#L381-L432](../../../../packages/sdk/src/vscoderootconfig.ts#L381-L432) - the seven `agentMerge.*` root config keys, advertised and read by nothing"
  - "[code://packages/sdk/src/sessions/changes.ts#L1254-L1261](../../../../packages/sdk/src/sessions/changes.ts#L1254-L1261) - `prepare-pull-request` answers `agentMergeAvailable: false`, and a create that asks for Agent Merge is refused"
  - "[code://packages/sdk/src/repo/github.ts#L34](../../../../packages/sdk/src/repo/github.ts#L34) - `githubPullRequests`, a branch's pull requests through a lent token or `gh`, with no checks or review threads"
  - "[code://packages/sdk/src/tools/artifacts.ts#L184](../../../../packages/sdk/src/tools/artifacts.ts#L184) - `artifactTools`, the pattern for a VS Code tool group"
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/shared/agentMergeServerTools.ts - VS Code's four Agent Merge tools at 171e90619
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/shared/agentMergeToolRestrictions.ts - what a repair turn may touch
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/common/agentMerge.ts - the configuration, the actions and the state
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/agentMergeController.ts - the controller that watches a pull request and starts the turns
---

## Goal

With Agent Merge on for a folder, the host watches the folder's pull request.
A failed required check, a review thread or a conflict starts a turn that fixes it.
The host never merges in this plan; the merge is host/20261110-0813-agent-merge-merges-a-pull-request.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `git grep -n "setAgentMergeEnabled\|readAgentMergeCI" -- packages` - none.
- `grep -n agentMerge packages/sdk/src/vscoderootconfig.ts` - the seven keys, with VS Code's defaults.

### Runtime path

```
setAgentMergeEnabled -> folder state -> watch: checks, review threads, mergeable state (GitHub)
  -> a repair action (fixCI, addressReviews, resolveConflicts) -> a turn in the chat
  -> readAgentMergeCI / replyToAgentMergeReviewThread / rerunAgentMergeWorkflow, only in that turn
```

### Gaps

- ahpd reads no checks, jobs, logs or review threads from GitHub.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Two plans: the watch and the repair turns first, the merge second | Softov, 2026-11-10, chose "Two plans" | - |
| `mergePullRequest` stays `never` in this plan, whatever the key says | Softov, 2026-11-10, the same answer | 02 |
| The four tools are served under VS Code's names and text | the brief; Softov, 2026-11-10, chose "VS Code's words" | 03 |
| VS Code's main at 171e90619 is the reference | Softov, 2026-11-10, chose "VS Code's newer main" | 01-04 |
| GitHub is read through `gh` or a lent token, as `githubPullRequests` reads | (defaulted: the sibling's way) | 01 |
| A pull request's review comments are read here, for the repair turns | Softov, 2026-11-10, put them with Agent Merge for the comments plan | 01 |

## Proposed architecture

- **Data flow** - `repo/github.ts` reads checks, jobs, logs and review threads; a new host part keeps each folder's Agent Merge state and starts the turns.
- **Event flow** - the watch polls the pull request, and a repair action starts a turn in the chat.
- **State flow** - each folder's Agent Merge state is kept with the session, as VS Code's `agentMerge.ts` holds it.
- **Layer responsibilities** - sdk: `repo/github.ts`, a host part for the watch, a tool group. docs: `TOOLS.md`.
- **Source-of-truth files** - [`code://packages/sdk/src/repo/github.ts`](../../../../packages/sdk/src/repo/github.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - GitHub reads checks and review threads](task-01-github-reads-checks-and-threads.md) | implemented | - |
| [02 - The watch starts a repair turn](task-02-the-watch-starts-a-repair-turn.md) | implemented | 01 |
| [03 - The four Agent Merge tools](task-03-the-four-agent-merge-tools.md) | todo | 02 |
| [04 - prepare-pull-request offers Agent Merge](task-04-prepare-pull-request-offers-it.md) | todo | 03 |

## Risks and tradeoffs

- VS Code's controller and tools are about 200 KB. Each task reads only the part of them it builds.
- A repair turn runs with the person away. It acts only on what VS Code's restrictions allow.

## Resume state

- **Done so far:** task 01. `githubPullRequests()` answers `detail`, `jobs` and `jobLog` through a lent token or `gh`, with the CI evidence capped at 48,000 characters. Task 02. `ctx.agentMerge` watches each folder's pull request every 60 s and starts one repair turn for a failed required check, an unresolved review thread or a conflict, as the root keys and the folder's overrides allow, and never merges.
- **Next action:** [task-03-the-four-agent-merge-tools.md](task-03-the-four-agent-merge-tools.md).
- **Open questions:** none.
- **Watch out for:** a pending review reply stops the folder's monitoring when the turn ends, as VS Code does; the person turns it on again.

## Final verification checklist

- [ ] With Agent Merge on, a failed required check starts a turn that reads the CI and fixes it.
- [ ] A review thread starts a turn that answers it, and the reply is published before the thread is resolved.
- [ ] A conflict starts a turn that resolves it.
- [ ] The host never merges, with any `mergePullRequest` value.
- [ ] `pnpm typecheck` and the sdk suite pass, and Windows CI is green.
