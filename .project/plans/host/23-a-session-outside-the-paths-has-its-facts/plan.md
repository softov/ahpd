---
title: A session outside the configured paths has its git facts and its changes without waiting for a turn
domain: host
status: built
priority: high
created: 2026-09-27
revalidated: 2026-09-27
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/sdk/src/host.ts#L437-L443](../../../../packages/sdk/src/host.ts#L437-L443) - `browsable`: the configured path and the folders an agent names, the only folders read at startup"
  - "[code://packages/sdk/src/host.ts#L2082-L2087](../../../../packages/sdk/src/host.ts#L2082-L2087) - the startup loop that reads git facts, pull requests and changes for `browsable()` only"
  - "[code://packages/sdk/src/host.ts#L2171-L2177](../../../../packages/sdk/src/host.ts#L2171-L2177) - `dirOf`: a session's folder, from its lead chat or from the listed row's `wheres`"
  - "[code://packages/sdk/src/host.ts#L1972-L1976](../../../../packages/sdk/src/host.ts#L1972-L1976) - `changesOf`: the diff stat a catalogue row carries, read from what `changes.refresh` last held"
  - "[code://packages/sdk/src/host.ts#L2022-L2043](../../../../packages/sdk/src/host.ts#L2022-L2043) - `summaryMoved`: announces a live session's row, and carries no changes for a row that is only listed"
  - "[code://packages/sdk/src/host.ts#L2664-L2676](../../../../packages/sdk/src/host.ts#L2664-L2676) - `inThere` and `metaMoved`: live sessions only"
  - "[code://packages/sdk/src/host.ts#L2792-L2810](../../../../packages/sdk/src/host.ts#L2792-L2810) - `refreshPullRequests`, which needs the git facts' GitHub owner and repo"
  - "[code://packages/sdk/src/host.ts#L2882-L2903](../../../../packages/sdk/src/host.ts#L2882-L2903) - `refreshFacts`, the pattern to reuse: facts, pull requests, then changes, announcing what moved"
  - "[code://packages/sdk/src/host.ts#L3166](../../../../packages/sdk/src/host.ts#L3166) - a finished turn, the only call of `refreshFacts` for a folder outside `browsable()`"
  - "[code://packages/sdk/src/host.ts#L3332-L3380](../../../../packages/sdk/src/host.ts#L3332-L3380) - `listing`: stored sessions from every agent's `list()`, with their folders"
  - "[code://packages/sdk/src/host.ts#L5095-L5115](../../../../packages/sdk/src/host.ts#L5095-L5115) - subscribing to a changeset: refreshes the files, never the git facts, and ignores whether they moved"
  - "[code://packages/sdk/src/changes.ts#L918-L932](../../../../packages/sdk/src/changes.ts#L918-L932) - the pull request pair is offered only when the context carries `github`, which comes from the git facts"
  - "[code://packages/sdk/src/git.ts#L60-L110](../../../../packages/sdk/src/git.ts#L60-L110) - the git facts, including `githubOwner` and `githubRepo` from `origin`"
  - "[code://packages/sdk/test/changes-refresh.test.ts](../../../../packages/sdk/test/changes-refresh.test.ts) - the tests that already drive a changeset refresh against a scratch repository"
---

## Goal

A session whose folder is not one of the host's configured paths shows its change counts in the session list and offers Create PR as soon as a client looks, not only after its next turn ends.
On 2026-09-27 an s2cmd session in `/github/s2cmd`, outside the daemon's `paths`, showed no change counts in ahpapp's list and no pull request operation, while its Changes screen listed the files.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "directories?.refresh" packages/sdk/src/host.ts` - two callers: the startup loop over `browsable()` and `refreshFacts`.
- `rg -n "refreshFacts\(" packages/sdk/src/host.ts` - a finished or cancelled turn, and an operation that wrote.
- `rg -n "changes?.refresh" packages/sdk/src/host.ts` - the startup loop, `refreshWatched`, `refreshFacts`, the changeset subscribe, and after an operation.
- `~/.config/ahpd/config.json` on Softov's machine: `paths` is `/github/ahpapp`, `/github/ahpd`, `/github/ahpc`, and the daemon restarted at 21:25 that day.
- `/github/s2cmd`: `origin` is `git@github.com:softov/s2cmd.git`, the branch is `main`, and `gh pr list --head main` lists no pull request, so neither the remote nor an open request explains the missing operation.

### Runtime path

```
daemon start -> browsable() folders read (facts, pull requests, changes) -> other folders never read
listSessions -> changesOf(dir) -> nothing held for the folder -> row without changes
subscribe changeset -> changes.refresh(dir) -> state(): operations context has no github (no facts) -> no Create PR
turn ends -> refreshFacts(dir) -> facts, pull requests, changes -> row and verbs appear
[new] subscribe changeset -> facts and pull requests first -> state() offers the pair; a move is announced
[new] daemon start -> each stored session's folder read once, one at a time -> rows that moved are announced
```

### Gaps

- Subscribing to a changeset does not read the folder's git facts, so the operations it answers lack the pull request pair until a turn ends.
- Subscribing refreshes the files but does not announce a move, so the session's row keeps its old counts.
- At startup only `browsable()` folders are read, so a stored session in any other folder lists with no counts.
- `summaryMoved` announces a row only for a live session; a row that is only listed cannot be told its counts moved.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Opening a changeset reads the folder's git facts and pull requests before answering, and announces what moved. | Softov, 2026-09-27, reporting the s2cmd session: "s2cmd cannot make pr... it did not show the option", then "make a worktree on ahpd-worktree01 and plan there". | 01 |
| At startup, the folders of stored sessions are read too, not only the configured paths. | Softov, 2026-09-27: "the session does not show the files changes I think is because its not on config mapped folders", then the same answer. | 02 |
| The startup read of those folders runs one folder at a time and never delays the host answering. | (defaulted: a host with many stored sessions would otherwise start by running every folder's `git` at once; Softov may change it) | 02 |
| This plan is written and implemented in the worktree `/github/ahpd-worktree01`, by a subagent, and reviewed after. | Softov, 2026-09-27: "make a worktree on ahpd-worktree01 and plan there... use a subagent to implement.. then review the implementation." | 01, 02 |

## Proposed architecture

- **Data flow** - A folder's facts (`directories.refresh`), its pull requests (`refreshPullRequests`) and its changes (`changes.refresh`) are read by one helper shaped like `refreshFacts`, called from the changeset subscribe and from a startup pass over stored sessions' folders.
- **Event flow** - What moved is announced as `refreshFacts` does for live sessions (`metaMoved`, `session/changesetsChanged`, `summaryMoved`); a row that is only listed gets `root/sessionSummaryChanged` with its `changes` from `changesOf`.
- **State flow** - Nothing new is stored; the facts and the change summary are the caches `git.ts` and `changes.ts` already keep per folder.
- **Layer responsibilities** - sdk: all of it, in `host.ts`. No client change: ahpapp and VS Code already draw the counts and the operations when they arrive.
- **Source-of-truth files** - [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Opening a changeset reads the folder's git facts first](task-01-opening-a-changeset-reads-the-facts.md) | done | - |
| [02 - A stored session's folder is read at startup](task-02-a-stored-sessions-folder-is-read-at-startup.md) | done | 01 |

## Risks and tradeoffs

- Reading the facts on subscribe adds `git status`, `git remote get-url` and, where there is a GitHub remote, one GitHub request before the first answer - once per open, like the files refresh it sits beside.
- A host with many stored sessions in many folders runs `git` once per folder at startup; one at a time, after the host is listening, keeps that off the first answer.
- Another session is changing `host.ts` for host/21 and host/22 on `main`; this branch starts at `e1c5e73` and is rebased before it is merged.

## Resume state

- **Done so far:** every task is `done`, reviewed by Softov on 2026-09-28; the plan is built, see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** a folder in `browsable()` is already read at startup and must not be read twice; a listed row has no `Held`, so `summaryMoved` says nothing about its counts.

## Final verification checklist

- [ ] A session in a folder outside the paths offers Create PR on the first open of its changeset, where the folder has a GitHub remote and changes.
- [ ] After a restart, that session's row lists its change counts without a turn.
- [ ] `pnpm typecheck`, `pnpm boundary` and `pnpm test` green.
- [ ] By hand, for Softov: restart the daemon, open ahpapp, and the s2cmd session shows its counts in the list and Create PR in its Changes screen.
- [ ] `plans/index.md` updated.
