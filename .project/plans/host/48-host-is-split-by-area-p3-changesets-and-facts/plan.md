---
title: Changesets and git and GitHub facts are files of their own, and the repository ports live in repo/
domain: host
status: built
priority: high
created: 2026-10-03
revalidated: 2026-10-03
requires:
  - plans/host/48-host-is-split-by-area-p2-routing/plan.md
refs:
  - "[code://packages/sdk/src/host.ts#L2680-L2697](../../../../packages/sdk/src/host.ts#L2680-L2697) - `dirOf`, called from 18 places"
  - "[code://packages/sdk/src/host.ts#L2720-L2997](../../../../packages/sdk/src/host.ts#L2720-L2997) - `catalogueOf` to `changesetsOf`: a session's changesets, their operations and what each watcher was last told"
  - "[code://packages/sdk/src/host.ts#L3056-L3518](../../../../packages/sdk/src/host.ts#L3056-L3518) - `githubFacts` to `refreshFacts`: `_meta`, the pull request baseline, artifacts, `describes`, the directory watches"
  - "[code://packages/sdk/src/host.ts#L2699-L2718](../../../../packages/sdk/src/host.ts#L2699-L2718) - `logs` and `stateFileOf`, between them and not theirs: `logs` stays, `stateFileOf` moves in p9"
---

## Goal

What a session's folder says, its changesets, its git and GitHub facts, its pull requests and its artifacts, is two files, read without the rest of the host.
The ports that answer those facts, `git.ts`, `github.ts` and `worktrees.ts`, move to `packages/sdk/src/repo/`, unchanged inside.
A later plan, not this one, lifts `repo/` into a default-loaded plugin package that registers the `directories`, `worktrees` and `github` ports through `PluginHost` (`registerDirectories`, `registerWorktrees`, `registerGithub`), the way `packages/computer` registers `computers`.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `grep -nE "\bdirOf\(" packages/sdk/src/host.ts` - 18 callers across every area, so `host.ts` destructures it from the changesets factory.
- Changesets read `options.changes`, `options.directories`, `options.github` and the shared maps and functions `tsc` names once the bodies move, `lent` (p4) among them.
- Facts read `kept`, `options.changes`, `options.github`, `options.directories`, `dispatch`, `summaryMoved` (p6), `catalogueOf`, and write `githubFacts`, `refreshing`, `waiting`, `dirWatchers`.
- Open plans that cite the code this child moves: host/30 (`changesetAt`), host/43 p4 (`owner` beside the git facts in `metaOf` and `describes`); for `repo/`, container/05 p7 and p8 cite `worktrees.ts` and `git.ts`.
- `rg -n "(git|github|worktrees)\.js'" packages` - `index.ts:35,49,50`, `host.ts:30`, and five tests: `git.test.ts`, `git-locks.test.ts`, `changes-refresh.test.ts`, `github.test.ts`, `worktrees.test.ts`; `packages/server` imports the three from `@ahpd/sdk` only.

### Gaps

- `startWatchingDir` is called from `contentMoved` and from `subscribe`, so the facts factory offers it.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Every factory takes the `HostContext`, and adds its area's fields to `host/context.ts` | the parent's second table, Softov's "One HostContext" | 01, 02 |
| A function from another area (`lent`, `summaryMoved`) is read as `ctx.<name>` when called | the parent's *Proposed architecture* | 01, 02 |
| `git.ts`, `github.ts` and `worktrees.ts` move to `packages/sdk/src/repo/` with their names inside unchanged; `changes.ts` stays | Softov, 2026-10-03, asked "git / GitHub / worktrees: where should they live?": "sdk/src/repo now, plugin later" | 03 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A session's changesets are one file](task-01-changesets.md) | done | - |
| [02 - Git and GitHub facts, pull requests and artifacts are one file](task-02-facts.md) | done | 01 |
| [03 - The git, GitHub and worktree ports live in repo/](task-03-repo.md) | done | 02 |

## Resume state

- **Done so far:** built 2026-10-03, see [implemented.md](implemented.md).

## Final verification checklist

- [x] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass; `test/changes-*.test.ts`, `test/pullrequest.test.ts`, `test/commit.test.ts`, `test/operations.test.ts`, `test/github.test.ts` and `test/watches.test.ts` cover this area.
- [x] `wc -l packages/sdk/src/host.ts` recorded in `implemented.md`, about 760 lines fewer than before.
- [x] `plans/index.md` updated.
