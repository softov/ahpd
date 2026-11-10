---
title: Agent Merge merges a pull request
domain: host
status: planned
priority: low
created: 2026-11-10
revalidated: 2026-11-10
requires:
  - plans/host/20261110-0813-agent-merge-repairs-a-pull-request/plan.md
changes: []
creates: []
refs:
  - git://7d76d5895 - the commit of ahpd this plan was checked at
  - git://e388d12f5:.project/briefs/tools-agent-merge.md - the brief this plan covers, with the repairs in host/20261110-0813-agent-merge-repairs-a-pull-request
  - "[code://packages/sdk/src/vscoderootconfig.ts#L381-L432](../../../../packages/sdk/src/vscoderootconfig.ts#L381-L432) - `mergePullRequest` and `mergeMethod` among the seven keys"
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/common/agentMerge.ts - `mergePullRequest` (`always`, `ifUnchanged`, `never`) and `mergeMethod`
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/agentMergeController.ts - when the controller merges
---

## Goal

A pull request with Agent Merge on merges once it is ready, only as the person allowed.
`never` stays the default, so the person merges by hand unless they say otherwise.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `grep -n mergePullRequest packages/sdk/src/vscoderootconfig.ts` - advertised with `never`, read by nothing.

### Runtime path

```
watch: required checks pass, reviews approved, no conflict -> mergePullRequest allows -> merge with mergeMethod
```

### Gaps

- None beyond the required plan.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The merge is its own plan, after the repairs | Softov, 2026-11-10, chose "Two plans" | 01 |
| `ifUnchanged` becomes `never` once a repair turn commits, as VS Code does | the brief; VS Code's `agentMerge.ts` | 01 |
| `never` stays the default | the brief | 01 |
| VS Code's main at 171e90619 is the reference | Softov, 2026-11-10, chose "VS Code's newer main" | 01 |

## Proposed architecture

- **Data flow** - the watch of the required plan merges through `gh` or a lent token when the keys allow.
- **Event flow** - a merge ends the folder's watch.
- **State flow** - `ifUnchanged` is held per folder and moves to `never` on a repair commit.
- **Layer responsibilities** - sdk: `host/agentmerge.ts` and `repo/github.ts`.
- **Source-of-truth files** - [`code://packages/sdk/src/vscoderootconfig.ts`](../../../../packages/sdk/src/vscoderootconfig.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The watch merges as allowed](task-01-the-watch-merges-as-allowed.md) | implemented | - |

## Risks and tradeoffs

- A merge cannot be undone. `never` is the default, and each case of `always` and `ifUnchanged` is tested with a stand-in API before any real repository.

## Resume state

- **Done so far:** task 01. The watch merges a ready pull request when `mergePullRequest` is `always`, or `ifUnchanged` with the local commit unchanged since a repair turn started; `never` stays the default. The method comes from `mergeMethod` among the repository's allowed methods, the head commit is pinned, and a merged pull request ends the folder's watch.
- **Next action:** none; the plan's only task is implemented and waits for Softov's review.
- **Open questions:** none.
- **Watch out for:** ahpd's own repository is merged by Softov by hand; never turn the merge on for it. A repository that requires a merge queue is not merged, and the watch stays. Four `worktrees.test.ts` cases fail under this session's `TMPDIR`, which is inside this checkout, so a folder meant to be outside a repository resolves to this worktree; the failure is environmental.

## Final verification checklist

- [ ] With `always`, a ready pull request merges with `mergeMethod`.
- [ ] With `ifUnchanged`, a repair commit stops the merge.
- [ ] With `never`, nothing merges.
- [ ] `pnpm typecheck` and the sdk suite pass, and Windows CI is green.
