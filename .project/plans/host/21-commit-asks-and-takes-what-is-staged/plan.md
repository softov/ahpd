---
title: The commit operation asks first, and commits what is staged when anything is
domain: host
status: active
priority: high
created: 2026-09-27
revalidated: 2026-09-27
requires: []
changes: []
creates: []
decisions:
  - decisions/a-commit-asks-first-and-names-what-it-takes.md
  - decisions/a-commit-takes-the-index-when-anything-is-staged.md
refs:
  - "[code://packages/sdk/src/changes.ts#L121-L129](../../../../packages/sdk/src/changes.ts#L121-L129) - `COMMIT`, declared with no `confirmation`"
  - "[code://packages/sdk/src/changes.ts#L362-L440](../../../../packages/sdk/src/changes.ts#L362-L440) - `look`: one pass over `git status --porcelain=v1 -z`, where each row is built"
  - "[code://packages/sdk/src/changes.ts#L809-L834](../../../../packages/sdk/src/changes.ts#L809-L834) - `operations`, what the uncommitted scope offers"
  - "[code://packages/sdk/src/changes.ts#L849-L904](../../../../packages/sdk/src/changes.ts#L849-L904) - the `commit` branch of `invoke`"
  - "[code://packages/sdk/src/changes.ts#L951-L961](../../../../packages/sdk/src/changes.ts#L951-L961) - `refresh`, which reports a move only when the summary's counts change"
  - "[code://packages/sdk/src/types/changes.ts#L171-L211](../../../../packages/sdk/src/types/changes.ts#L171-L211) - `ChangesetOperationContext` and `ChangesetOperationRequest`; `subject` is on the request only"
  - "[code://packages/sdk/src/host.ts#L2292-L2342](../../../../packages/sdk/src/host.ts#L2292-L2342) - `operationsOf` and `operationsMoved`, which re-declare a changeset's operations"
  - "[code://packages/sdk/src/host.ts#L2420-L2434](../../../../packages/sdk/src/host.ts#L2420-L2434) - `contentMoved`, which re-sends files and operations after a refresh"
  - "[code://packages/sdk/src/host.ts#L4458-L4470](../../../../packages/sdk/src/host.ts#L4458-L4470) - `renameChat`, where a session title changes"
  - "[code://packages/sdk/src/host.ts#L6756](../../../../packages/sdk/src/host.ts#L6756) - the session title handed to `invoke` as `subject`"
  - file:///github/externals/vscode - `src/vs/sessions/contrib/providers/agentHost/browser/agentHostSessionChangesets.ts`: VS Code lists only the changeset kinds it knows, keyed by kind, and shows an operation's `confirmation` before invoking it; `src/vs/platform/agentHost/node/agentHostGitService.ts` `commitAll` is the reference host's `add -A` and commit
  - file:///github/externals/agent-host-protocol/types/channels-changeset/state.ts - `ChangesetFile._meta` and `ChangesetOperation.confirmation`
---

## Goal

Committing from a session in VS Code is a deliberate act that says what it will do, and it commits what the person staged in VS Code's Source Control when they staged anything.
On 2026-09-27 one click on Commit in VS Code committed another session's uncommitted files under "Changes from an agent session".

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- VS Code's session Changes view (`agentHostSessionChangesets.ts`): the kinds listed are `branch`, `uncommitted`, `session`, `turn` and its agent merge, keyed by `changeKind`, so a changeset of any other kind, such as a separate "Staged" one, is never shown.
  It never reads a row's `_meta` staging and never sends a file selection.
- VS Code's `changesActions.ts`: a resource-scoped operation is drawn as a button on every row, and a changeset-scoped one on the view's toolbar; `agentHostSessionChangesets.ts:380` shows a `confirmation` before invoking.
- `rg -n "refresh" packages/sdk/src/host.ts` - the uncommitted changeset is refreshed at start, on subscribe, after a turn and after an operation; nothing watches git, so staging done in another program is not seen until one of those.
- `git status --porcelain=v1 -z` on a staged rename (`git mv old.txt new.txt`) answers `R  new.txt\0old.txt\0`, and `look` reads `old.txt` as a record of its own: code `ol`, path `.txt`.

### Runtime path

```
git index/HEAD, tool call complete, client file write, terminal exit -> coalesced refresh (only when watched) -> contentMoved -> changeset rows + operations (confirmation) -> VS Code
Commit clicked -> confirmation shown -> invokeChangesetOperation commit -> git commit (index) or add -A + commit -> refresh
```

### Gaps

- `COMMIT` has no `confirmation`.
- `invoke`'s `commit` always stages everything, or, in the working tree's uncommitted draft, the files named in `_meta['ahp.commit'].files`.
- `operations` is not given the session title, so it cannot name the subject line.
- `refresh` does not see a change to the index alone, and the changeset is refreshed only at start, on subscribe, when a turn ends and after an operation.
- A staged rename makes a phantom row.

## Decisions locked in

| Decision | Tasks |
| --- | --- |
| [The commit operation asks first, naming its subject line and the files it will take](../../../decisions/a-commit-asks-first-and-names-what-it-takes.md) | 03 |
| [The commit operation commits the index when anything is staged, and everything when nothing is](../../../decisions/a-commit-takes-the-index-when-anything-is-staged.md) | 02, 03 |

| What | Source | Task |
| --- | --- | --- |
| This plan carries the commit work, and the other session's uncommitted draft of it is folded in rather than committed on its own. | Softov, 2026-09-27, asked who carries the commit work: "I plan host/21". | 01 |
| A row's `_meta.staged` and `_meta.unstaged` stay, for a client that can show them; VS Code ignores them. | the protocol's `ChangesetFile._meta`, and the draft | 01 |
| `_meta['ahp.commit'].files` goes: staging is the selection. | decision [a-commit-takes-the-index-when-anything-is-staged](../../../decisions/a-commit-takes-the-index-when-anything-is-staged.md), Consequences | 02 |
| `_meta['ahp.commit'].message` stays as the subject's replacement when a client sends one. | (defaulted: the protocol has no field for it, and the draft already reads it; Softov may drop it) | 02 |
| The uncommitted changeset also refreshes on git's `index` and `HEAD`, a completed tool call, a client's file write, and a terminal's exit, only while a client watches and coalesced per directory. | Softov, 2026-09-27, asked which extra refresh triggers go in: "Git index and HEAD, Tool call completes, Client file writes, Terminal exits". | 04 |
| The git watch closes whenever nobody watches its directory, and a watcher error falls back to the other triggers. | Softov, 2026-09-27, asked which review findings become fix tasks: "Git watcher lifecycle". | 06 |
| The git watch also covers the checked-out branch's ref and `packed-refs`. | Softov, 2026-09-27, asked what happens to a ref that moves alone: "Watch the branch ref too". | 07 |
| The joined `turn_end` line is split, and the unwatched case counts tool calls. | Softov, 2026-09-27, asked which review findings become fix tasks: "Joined line in host.ts, Unwatched test uses tool calls". | 08 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A row says what is staged, and a staged rename is one row](task-01-a-row-says-what-is-staged.md) | implemented | - |
| [02 - Commit takes the index when anything is staged](task-02-commit-takes-the-index-when-staged.md) | implemented | 01 |
| [03 - Commit asks first, naming its subject and its files](task-03-commit-asks-first.md) | implemented | 02 |
| [04 - The uncommitted changeset follows git, tool calls, client writes and terminals without waiting for a turn](task-04-staging-elsewhere-reaches-the-changeset.md) | implemented | 03 |
| [05 - The docs say what commit does](task-05-the-docs-say-what-commit-does.md) | implemented | 04 |
| [06 - The git watch closes when nobody watches its directory, and a watcher error falls back](task-06-the-git-watch-closes-with-its-directory.md) | implemented | 04 |
| [07 - The git watch sees the checked-out branch move](task-07-the-git-watch-sees-a-branch-move.md) | implemented | 06 |
| [08 - The host's turn_end line is two lines again, and the unwatched case counts tool calls](task-08-the-host-line-and-the-unwatched-case.md) | implemented | 04 |

## Risks and tradeoffs

- The working tree holds another session's uncommitted draft of this work in `docs/AHP.md`, `packages/sdk/src/changes.ts`, `packages/sdk/src/types/changes.ts` and `packages/sdk/test/commit.test.ts`.
  Task 01 starts from it; the refs' line numbers are that working tree's.
- A `confirmation` marks an operation as destructive in the protocol, so VS Code styles Commit as a warning.
- Watching `.git` is one watcher per repository directory a session works in, closed when no session is left there.
- Every new trigger runs `git status` and `git diff`; the watched-only rule and the per-directory coalescing are what keep that off a busy turn's path.
- Plan host/20 changes the same file and starts after this plan's tasks are committed.

## Resume state

- **Done so far:** tasks 01 to 08 are implemented; tasks 06 to 08 were the 2026-09-27 review's fixes.
- **Next action:** nothing in this plan; plan host/20 starts after this plan's tasks are committed.
- **Open questions:** none.
- **Watch out for:** VS Code shows no staging in the session view; the person stages in VS Code's Source Control and the session's Commit acts on it.
  A test commits in a scratch repository, never in the tree it runs from.

## Final verification checklist

- [ ] With changes staged, Commit's confirmation names the staged files and commits only them; with none staged, it names every change and commits them all.
- [ ] Staging in another program, a tool call mid-turn, a client's file write and a terminal's exit each move the changeset without a turn, and none of them runs git when nobody watches.
- [ ] A staged rename is one row.
- [ ] `pnpm typecheck`, `pnpm boundary` and `pnpm test` green.
- [ ] By hand, for Softov: in VS Code, stage one file in Source Control, click Commit in the session, read the confirmation, accept, and only that file is committed.
- [ ] `plans/index.md` updated.
