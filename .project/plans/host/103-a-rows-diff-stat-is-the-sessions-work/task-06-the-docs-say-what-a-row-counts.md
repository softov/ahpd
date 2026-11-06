---
title: The docs say what a row counts
status: done
depends:
  - task-04-a-rows-changes-are-the-sessions-summary.md
layer: docs
refs:
  - "[code://docs/sdk/SESSIONS.md#L48](../../../../docs/sdk/SESSIONS.md#L48) - `The state a session reports`"
  - "[code://docs/sdk/SESSIONS.md#L94](../../../../docs/sdk/SESSIONS.md#L94) - `Isolation and worktrees`"
---

## Objective

docs/sdk/SESSIONS.md says that a row's `changes` are Branch Changes for a worktree session and Session Changes otherwise.
It names the checkpoint refs and when they go.

## Files

- `UPDATE: docs/sdk/SESSIONS.md` - a paragraph in `The state a session reports`, and one line in `Isolation and worktrees`.

## Steps

1. Say what each kind counts, and that a commit does not take the counts to zero.
2. Name `refs/agents/<sid>/checkpoints/turn/<N>`, and say that the refs go with the session.
3. Set this task and the plan row to `implemented`.

## Validation

- The page names both kinds, the refs and the fallback for a folder with no git.

## Resume

- **Done so far:** Built 2026-10-16.
  `docs/sdk/SESSIONS.md` has a paragraph on a row's `changes` under `The state a session reports`.
  A worktree session shows Branch Changes, which count everything since its base.
  A folder session shows Session Changes, which count the difference between the tree it started from and the tree its last turn ended with.
  A commit in the folder does not take the counts to zero.
  The counts are read when a turn ends and kept per session.
  A session this host has not read for reports its directory's uncommitted changes.
  A folder with no git falls back to the files the session's own tools wrote, as the reference host's `auto` strategy does.
  `Isolation and worktrees` names `refs/agents/<sid>/checkpoints/turn/<N>`.
  It says `turn/0` is the tree the session started from.
  It says nothing is checked out from the refs and no branch moves.
  It says `disposeSession` removes them with the session.
- **Next action:** none.
  Task 06 is the plan's last task, and nothing is set to `done`.
- **Open questions:** none of the task's own.
- **Watch out for:** The paragraph's last sentence describes the source's rule for a folder with no git.
  `sessionFiles` is the checkpoints where they answer and the edit tracker where they do not.
  A row reaches the tracker through the store the id names, and the tracker is keyed by the channel URI.
  That is the fault noted in task 04's Resume.
  So for a live row in a non-git folder, the page is ahead of what the daemon does today.
  Restore `packages/sdk/test/fixtures/wire.jsonl` with `git checkout -- packages/sdk/test/fixtures/wire.jsonl`; the suite dirties it.
