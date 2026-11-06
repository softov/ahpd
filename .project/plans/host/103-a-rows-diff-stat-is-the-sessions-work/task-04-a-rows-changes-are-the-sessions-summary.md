---
title: A row's changes are the session's summary
status: done
depends:
  - task-02-session-changes-come-from-checkpoints.md
  - task-03-a-worktree-session-has-branch-changes.md
layer: sdk
refs:
  - "[code://packages/sdk/src/host/catalogue.ts#L415-L422](../../../../packages/sdk/src/host/catalogue.ts#L415-L422) - `changesOf`"
  - "[code://packages/sdk/src/host/catalogue.ts#L519-L530](../../../../packages/sdk/src/host/catalogue.ts#L519-L530) - `summaryMoved`"
  - "[code://packages/sdk/src/types/sessions.ts#L167](../../../../packages/sdk/src/types/sessions.ts#L167) - `SessionStore`"
  - "[code://packages/sdk/src/sessions/sessions.ts#L505](../../../../packages/sdk/src/sessions/sessions.ts#L505) - `fileSessions`, the store on disk"
  - "file:///github/externals/vscode/src/vs/platform/agentHost/node/agentHostChangesetSummary.ts#L11-L15 - `getSummaryChangesetKind`"
  - "file:///github/externals/vscode/src/vs/platform/agentHost/node/agentHostChangesetService.ts#L362-L408 - `computeListEntryChanges`, the persisted summary of a row"
---

## Objective

`changesOf` gives a row Branch Changes for a worktree session and Session Changes otherwise.
The session store keeps the summary, so a restart keeps a row's counts.

## Files

- `UPDATE: packages/sdk/src/host/catalogue.ts:415-422` - `changesOf` picks the kind by `isolation`, as `getSummaryChangesetKind` does.
- `UPDATE: packages/sdk/src/host/catalogue.ts:519-530` - `summaryMoved` sends the session's counts.
- `UPDATE: packages/sdk/src/types/sessions.ts:167` - `SessionStore` gets `changes(id)` and `setChanges(id, summary)`.
- `UPDATE: packages/sdk/src/sessions/sessions.ts` - `memorySessions` and `fileSessions` keep the summary.
- `UPDATE: packages/sdk/test/host-catalogue.test.ts` - the cases in Validation.

## Steps

1. Write the tests first.
2. Write `summaryKindOf(uri)`: `branch` for `isolation: worktree`, else `session`.
3. Read the summary of that kind in `changesOf`, and keep a summary with no files out of the row.
4. Keep the summary in the store each time it moves.
5. Read the kept summary for a row of a session that is not loaded.
6. Set this task and the plan row to `implemented`.

## Validation

- A test: two sessions in one folder have different `changes` in their rows.
- A test: a worktree session's row has its Branch Changes.
- A test: a row read from a new store after a restart has the counts it had.
- A test: `session/summaryChanged` carries the session's counts after a turn.
- `pnpm -s typecheck` and the sdk vitest suite pass.

## Resume

- **Done so far:** Built 2026-10-16.
  `host/catalogue.ts` has `summaryKindOf`, which gives `branch` for a session with a worktree record and `session` otherwise.
  `changesOf` reads the summary the host kept for that session.
  It falls back to the directory's counts only for a session nothing has been read for.
  `summaryKept(uri)` reads the summary of that kind, keeps it in the store and moves the row.
  `SessionStore` has `changes(id)` and `setChanges(id, value)`, held in memory and on disk.
  A validator guards the file, because a person can edit it by hand.
  `spawn.ts` calls `summaryKept` after the baseline and at every turn end, before the directory's facts are re-read.
  4 tests are in `test/host-catalogue.test.ts`.
  The gates pass, and the sdk suite passes with 2998 tests.
- **Next action:** [task-05-a-failed-turn-moves-the-counts.md](task-05-a-failed-turn-moves-the-counts.md).
- **Open questions:** none of the task's own.
  Four choices it did not decide are noted under Watch out for.
- **Watch out for:** The task was silent on four points, and a choice was made for each.
  (1) No File names the turn-end wiring in `spawn.ts`.
  The turn end is the only moment that step 4 can mean, and it is where the checkpoint is taken.
  (2) The kind comes from the persisted worktree record, not from an `isolation: worktree` config value.
  In this host the config only reaches a running session, and the record outlives a restart.
  (3) `summaryKept` passes `idOf(uri)`, because checkpoints are committed under `refs/agents/<id>`.
  The channel URI measured as the tracker's empty answer.
  (4) A session the host never measured still falls back to the directory's counts.
  That is how a session listed from a backend's own record has counts at all.
  Fault reported, not fixed: `changes.ts` reads a session's files under two keys.
  `state` gets the channel URI, which `observe` also uses to key the tracker, and `sessionSummary` gets the id.
  So a live session's `session` scope never sees the checkpoints, and a row's counts never see the tracker.
  The plan's risk note for a folder with no git relies on the tracker.
  No task says which spelling is canonical.
  Restore `packages/sdk/test/fixtures/wire.jsonl` with `git checkout -- packages/sdk/test/fixtures/wire.jsonl`; the suite dirties it.
