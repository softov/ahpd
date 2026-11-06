---
title: A row's diff stat is the session's own work
domain: host
status: built
priority: medium
created: 2026-10-16
revalidated: 2026-10-16
refs:
  - "[idea: a row's diff stat is the session's work](https://github.com/softov/ahpd/blob/5e5f35ce034f24747bd952d4dfdadf2763740cbb/.project/ideas/a-rows-diff-stat-is-the-sessions-work.md) - the request, with three readings of the count"
  - "[code://packages/sdk/src/host/catalogue.ts#L415-L422](../../../../packages/sdk/src/host/catalogue.ts#L415-L422) - `changesOf`: a row's `changes` is the folder's summary"
  - "[code://packages/sdk/src/host/catalogue.ts#L519-L530](../../../../packages/sdk/src/host/catalogue.ts#L519-L530) - `summaryMoved`, which sends a row's new counts"
  - "[code://packages/sdk/src/sessions/changes.ts#L588-L692](../../../../packages/sdk/src/sessions/changes.ts#L588-L692) - `look`: `git status` and `git diff --numstat HEAD` of the folder"
  - "[code://packages/sdk/src/sessions/changes.ts#L1224](../../../../packages/sdk/src/sessions/changes.ts#L1224) - `summary(dir)`, the folder's counts held in memory"
  - "[code://packages/sdk/src/sessions/changes.ts#L485-L503](../../../../packages/sdk/src/sessions/changes.ts#L485-L503) - `fold` and `across`: every file a session's tools wrote, in memory only"
  - "[code://packages/sdk/src/sessions/changes.ts#L1057-L1102](../../../../packages/sdk/src/sessions/changes.ts#L1057-L1102) - `scopes`: `uncommitted`, `session` (\"This Session\"), turn and compare"
  - "[code://packages/sdk/src/types/changes.ts#L321-L345](../../../../packages/sdk/src/types/changes.ts#L321-L345) - `ChangesetSource`, with `summary(dir)` and `refresh`"
  - "[code://packages/sdk/src/host/spawn.ts#L999-L1004](../../../../packages/sdk/src/host/spawn.ts#L999-L1004) - the folder is read again on `chat/turnComplete` and `chat/turnCancelled` only"
  - "[code://packages/sdk/src/host/spawn.ts#L861-L870](../../../../packages/sdk/src/host/spawn.ts#L861-L870) - `chat/error`, a failed turn"
  - "[code://packages/sdk/src/host/sessionconfig.ts#L69-L82](../../../../packages/sdk/src/host/sessionconfig.ts#L69-L82) - `isolation`, `folder` or `worktree`, fixed for the session"
  - "[code://packages/sdk/src/host/changesets.ts#L390](../../../../packages/sdk/src/host/changesets.ts#L390) - `worktreeOf(uri)?.base`, the base branch of a worktree"
  - "[code://packages/sdk/src/types/sessions.ts#L167](../../../../packages/sdk/src/types/sessions.ts#L167) - `SessionStore`, where a session's own values are kept"
  - "file:///github/externals/vscode/src/vs/platform/agentHost/node/agentHostChangesetSummary.ts#L11-L15 - `getSummaryChangesetKind`: Branch Changes for a worktree session, else Session Changes"
  - "file:///github/externals/vscode/src/vs/platform/agentHost/common/agentHostChangesetService.ts#L29 - `META_CHANGES_SUMMARY` (`agentHost.changes`), the persisted summary"
  - "file:///github/externals/vscode/src/vs/platform/agentHost/common/agentHostChangesetService.ts#L63-L66 - `StaticChangesetKind` and `ChangesetDiffStrategy` (`auto`, `git`, `fileEditTracker`)"
  - "file:///github/externals/vscode/src/vs/platform/agentHost/node/agentHostChangesetService.ts#L2191-L2232 - `_tryComputeSessionGitDiffs`: a git diff from the baseline checkpoint to the latest turn checkpoint"
  - "file:///github/externals/vscode/src/vs/platform/agentHost/node/agentHostChangesetService.ts#L2005-L2024 - the summary of the kind that `getSummaryChangesetKind` picks is persisted and set on the session"
  - "file:///github/externals/vscode/src/vs/platform/agentHost/node/agentHostChangesetService.ts#L362-L408 - `computeListEntryChanges`: a row of a session that is not loaded reads the persisted summary"
  - "file:///github/externals/vscode/src/vs/platform/agentHost/common/agentHostCheckpointService.ts#L17-L68 - checkpoints at `refs/agents/<sid>/checkpoints/turn/<N>`, with the baseline at `turn/0`"
  - "file:///github/externals/vscode/src/vs/platform/agentHost/common/changesetUri.ts#L64-L67 - the labels \"Branch Changes\" and \"Session Changes\""
  - "file:///github/externals/vscode/src/vs/platform/agentHost/common/state/protocol/channels-session/state.ts#L489-L495 - `SessionSummary.changes`: \"file changes associated with this session\""
  - "file:///github/externals/vscode/src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts#L1080 - the sessions view draws `summary.changes`"
---

## Goal

A session row's `+` and `-` counts are what that session did, not what is uncommitted in its folder.
Two sessions in one folder show their own counts, and a commit does not take a session's counts to zero.
The counts follow VS Code's host: Branch Changes for a worktree session, else Session Changes.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.
VS Code was read at a959ba62444, 2026-10-14.

### Searches performed

- `rg -n "changesOf|summaryMoved" packages/sdk/src/host` - every row and every `session/summaryChanged` takes `changes` from `summary(dir)`.
- `rg -n "checkpoint" packages/sdk/src` - ahpd keeps no checkpoint of a turn.
- `rg -n "getSummaryChangesetKind|META_CHANGES_SUMMARY" vscode/src/vs/platform/agentHost` - VS Code picks the kind by isolation, and persists the summary.
- `rg -n "summary.changes" vscode/src/vs/sessions` - the sessions view draws the field as it comes.

### What VS Code does

- A session's summary is Branch Changes when its isolation is `worktree`, and Session Changes otherwise.
- Session Changes is a git diff from the baseline checkpoint (`turn/0`) to the checkpoint of the latest turn. It falls back to the edit tracker when git cannot answer.
- A checkpoint is a commit at a private ref of the session. It catches an edit from a terminal tool, and it survives a restart.
- Branch Changes is the diff from the merge base of the base branch.
- The summary is persisted per session as `agentHost.changes`, so a row of a session that is not loaded has its counts.

### Runtime path

```
turn ends -> checkpoint -> Session Changes (or Branch Changes) -> summary.changes -> persisted -> session/summaryChanged -> row
```

### Gaps

- A row's count is the folder's, from `look`.
- The `session` scope knows only what the agent's tools wrote, and a restart loses it.
- A failed turn does not read the counts again.
- ahpd has no Branch Changes scope.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The protocol field stays `SessionSummary.changes` | (defaulted: the spec says \"associated with this session\", and VS Code reads that field) | 04 |
| The names follow VS Code: \"Session Changes\", \"Branch Changes\", and `branch` for the kind | (defaulted: upstream parity) | 02, 03 |
| A session with no turn yet has no `changes` | (defaulted: `changesOf` already leaves out a summary with no files) | 04 |
| The `uncommitted` scope stays, with its count, in the session's changesets | (defaulted: VS Code keeps Uncommitted Changes beside the two) | - |
| The count is VS Code's Session Changes from git checkpoints, with Branch Changes for a worktree, and the edit tracker as the fallback | Softov, 2026-10-16, chose the recommended answer for "What does a session's count come from?" | 01, 02, 03, 04 |
| The summary is kept per session in the session store | Softov, 2026-10-16, chose the recommended answer for "Is the summary persisted per session?" | 04 |
| A failed turn moves the counts | Softov, 2026-10-16, chose the recommended answer for "Does a failed turn move the counts?" | 05 |
| A chat carries no `changes` of its own in this plan | Softov, 2026-10-16, chose the recommended answer for "Does each chat carry its own `changes` too?" | - |

## Proposed architecture

- **Source of the count** - VS Code's checkpoints, with the edit tracker of today as the fallback.
- **Checkpoints** - at the first turn, the host writes the tree as a commit at `refs/agents/<sid>/checkpoints/turn/0`. At the end of each turn, it writes `turn/<N>`. The commits use a temporary index, so the person's index and branch do not move.
- **Pick** - the summary is Branch Changes for `isolation: worktree`, else Session Changes, as `getSummaryChangesetKind` does.
- **Persist** - the session store keeps the summary, as VS Code keeps `agentHost.changes`.
- **Layer responsibilities** - sdk `changes.ts`: the checkpoints and the two scopes. sdk `host/catalogue.ts`: the pick and the row. sdk `sessions.ts`: the persisted summary. server: nothing.
- **Source-of-truth files** - [`code://packages/sdk/src/sessions/changes.ts`](../../../../packages/sdk/src/sessions/changes.ts), [`code://packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A turn leaves a checkpoint](task-01-a-turn-leaves-a-checkpoint.md) | done | - |
| [02 - Session Changes come from the checkpoints](task-02-session-changes-come-from-checkpoints.md) | done | 01 |
| [03 - A worktree session has Branch Changes](task-03-a-worktree-session-has-branch-changes.md) | done | - |
| [04 - A row's changes are the session's summary](task-04-a-rows-changes-are-the-sessions-summary.md) | done | 02, 03 |
| [05 - A failed turn moves the counts](task-05-a-failed-turn-moves-the-counts.md) | done | 04 |
| [06 - The docs say what a row counts](task-06-the-docs-say-what-a-row-counts.md) | done | 04 |

## Risks and tradeoffs

- A checkpoint of a large tree is slow - It runs after the turn ends, and the row moves when it is ready.
- Private refs grow the repository - The refs of a session go with the session, as VS Code removes them.
- A folder that is not a git repository has no checkpoint - The count falls back to the edit tracker, as VS Code's `auto` strategy does.

## Resume state

- **Done so far:** The plan was written 2026-10-16, and Softov answered the open questions the same day.
  Task 01 built `checkpoints.ts`, two port methods, the captures in `spawn.ts` and the removal in `lifecycle.ts`, with 5 tests.
  Task 02 made the `session` scope a diff of the session's own checkpoints, with `sessionSummary` on the port.
  Task 03 built `mergeBaseOf`, `branchLook` and the `branch` scope with `branchSummary`, with 5 tests.
  Task 03 also gave `state` a fourth argument and `changesetAt` the base.
  Task 04 built `summaryKindOf`, the per-session summary in the store, `changesOf`, `summaryKept` and the `spawn.ts` calls, with 4 tests.
  Task 05 added `chat/error` to the turn end in `spawn.ts`, with 1 test.
  Task 06 made `docs/sdk/SESSIONS.md` say what a row's `changes` counts, for both kinds, the checkpoint refs and the fallback.
  The gates and the sdk suite pass with 2999 tests.
  On review (2026-10-18), `commit-tree` got a fixed `ahpd` identity, so a checkpoint is written where git has no identity, with a test.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
  Nothing is set to `done`.
  The work is committed in `06596413` and waits for Softov's review.
- **Open questions:** none.
- **Watch out for:** The idea's line refs are stale, so use the refs above.
  `look` stays, because the `uncommitted` scope and the folder's facts read it.
  Each turn's `add -A` on a fresh index hashes the whole tree, which is slow on a large repository.
  Untracked files that are not ignored go into the object store.
  Tasks 01, 03 and 04 chose sites their Files lists did not name; each task's Resume gives them.
  The fault in task 04's Resume is open: `changes.ts` reads a session's files under the channel URI and under the id.
  It is the problem [a-sessions-changes-are-kept-under-two-keys.md](../../../problems/a-sessions-changes-are-kept-under-two-keys.md).
  A live session's `session` scope never sees the checkpoints, and a row's counts never see the tracker.
  No task decides which spelling is canonical.
  `packages/sdk/test/changes-refresh.test.ts` case `announces the session's counts` now passes on a timing.
  The row gains the session's own zero counts a moment after the test asserts the directory's 1.
  A temporary probe measured three moves in the row.

## Final verification checklist

- [ ] Two sessions in one folder show their own counts.
- [ ] A commit in the folder leaves a session's counts as they were.
- [ ] A file that a shell command of the agent wrote is counted.
- [ ] A worktree session shows its Branch Changes.
- [ ] After a daemon restart, a row shows the counts it had.
- [ ] VS Code's sessions view and ahpapp draw the counts without a change.
