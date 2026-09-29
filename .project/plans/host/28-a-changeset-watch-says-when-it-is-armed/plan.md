---
title: A changeset watch says when it is armed, and nothing between the first read and the watch is missed
domain: host
status: built
priority: high
created: 2026-09-28
revalidated: 2026-09-28
requires: []
refs:
  - "[code://packages/sdk/src/types/changes.ts#L276-L284](../../../../packages/sdk/src/types/changes.ts#L276-L284) - `ChangesetSource.watch`"
  - "[code://packages/sdk/src/changes.ts#L1184-L1300](../../../../packages/sdk/src/changes.ts#L1184-L1300) - the git watch, armed after three `git` runs"
  - "[code://packages/sdk/src/host.ts#L2794-L2856](../../../../packages/sdk/src/host.ts#L2794-L2856) - `refreshWatched` and `startWatchingDir`"
  - "[code://packages/sdk/test/changes-refresh.test.ts#L264-L277](../../../../packages/sdk/test/changes-refresh.test.ts#L264-L277) - the coalesce case, which counts after a fixed `settle(20)`"
  - "[code://packages/sdk/test/changes-refresh.test.ts#L371-L395](../../../../packages/sdk/test/changes-refresh.test.ts#L371-L395) - the branch-move case, which commits after a fixed `settle(10)`"
---

## Goal

A repository change made right after a changeset is first read reaches the client, because the host re-reads once the watch is armed.
The two changes-refresh cases that flake under load wait on conditions, not on a number of event-loop turns.

## Reconnaissance

The files read are the `refs` above.

### Runtime path

```
subscribe changeset -> first read -> startWatchingDir -> gitChanges.watch: rev-parse, rev-parse, symbolic-ref -> watchers opened
                                   a commit in this window is seen by nobody
```

### Gaps

- Branch-move case, "the change never arrived": the commit lands before the watchers are open; about 1 in 18 under load.
- Coalesce case, `expected 1 to be greater than 1`: `settle(20)` ends before the first real `git` re-read does; about 1 in 18 under load.

## Decisions locked in

| Decision | Source |
| --- | --- |
| [A changeset source says when its watch is armed, and the host re-reads then](../../../decisions/a-changeset-watch-says-when-it-is-armed.md) | Softov, 2026-09-28 |

| What | Source | Task |
| --- | --- | --- |
| Fixed before 0.8.0 | Softov, 2026-09-28, asked "What about the sdk changes-refresh flakes (about 1 in 18 under load)?": "Fix before 0.8.0" | 01, 02 |
| The coalesce case waits on its counting source until two re-reads have finished and none is running, and keeps its "at most two" assertion | Same decision's Consequences | 02 |
| Every git run in `gitChanges` sets `GIT_OPTIONAL_LOCKS=0`, so a background read never takes `index.lock` | Softov, 2026-09-28, asked "The daemon's background `git status` takes .git/index.lock, so a person's `git add` at the same moment fails with \"index.lock: File exists\"... How should gitChanges read?": "No optional locks" | 03 |
| `gitBranches` runs its git the same way, since it reads in the background too | Softov, 2026-09-28, asked "gitBranches (git.ts:30) still runs a background `git status` that takes index.lock. Include it before 0.8.0?": "Include it now" | 05 |
| A re-read whose directory is gone ends quietly: the promise on the re-read path that rejects unhandled gets its catch in product code; the host gets no teardown API | Softov, 2026-09-28, asked "A re-read still running after a test removed its temp directory ended in an unhandled rejection... Whose job is it?": "Product catches it" | 04 |

## Proposed architecture

- **Data flow** - `gitChanges().watch` returns its stop function with `ready`; `startWatchingDir` calls `refreshWatched(dir)` when `ready` resolves, unless the watch was stopped first.
- **Layer responsibilities** - sdk only: the type, `gitChanges`, the host, and the tests.
- **Source-of-truth files** - [`code://packages/sdk/src/types/changes.ts`](../../../../packages/sdk/src/types/changes.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The git watch says when it is armed, and the host re-reads then](task-01-the-watch-says-when-it-is-armed.md) | done | 03 |
| [02 - The coalesce case waits on its source](task-02-the-coalesce-case-waits-on-its-source.md) | done | - |
| [03 - A background git read takes no optional lock](task-03-a-background-git-read-takes-no-lock.md) | done | - |
| [04 - A re-read whose directory is gone ends quietly](task-04-a-re-read-of-a-gone-directory-ends-quietly.md) | done | - |
| [05 - gitBranches takes no optional lock either](task-05-gitbranches-takes-no-lock.md) | done | 03 |

## Risks and tradeoffs

- One extra `git status` per watched directory, once, when its watch is armed.
- The coalesce case's counting source returns no `ready`, so the new re-read does not change what it counts.

## Resume state

- **Done so far:** every task done 2026-09-28 (`bde31b5`), approved by Softov; see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** `validate.ts` checks `watch` is a function; a function with a `ready` property still is.

## Final verification checklist

- [ ] A commit made right after the first read, before `ready`, reaches the client.
- [ ] `changes-refresh.test.ts` has no `settle` before an assertion about git or a count of re-reads.
- [ ] `docs/` that describe `ChangesetSource.watch` name `ready`.
- [ ] `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
