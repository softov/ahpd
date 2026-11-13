---
title: Cases that run git fail at random on Windows
status: open
date: 2026-11-13
severity: minor
refs:
  - "[code://packages/sdk/test/changes-refresh.test.ts#L217](../../packages/sdk/test/changes-refresh.test.ts#L217) - \"re-reads a changeset when git is changed outside the host\""
  - "[code://packages/sdk/test/changes-refresh.test.ts#L1332](../../packages/sdk/test/changes-refresh.test.ts#L1332) - \"moves a worktree row at a tool call, from its branch, before the turn ends\""
  - "[code://packages/sdk/test/worktrees.test.ts#L839](../../packages/sdk/test/worktrees.test.ts#L839) - \"answers the branches a client types for, not the whole list\""
---

## Symptom

Three cases that run `git` fail at random in `windows (3/4)`, and pass when the job runs again on the same commit. They pass on Linux.

| Case | Run | What it said |
| --- | --- | --- |
| changes-refresh, "re-reads a changeset when git is changed outside the host" | 42760023503 | `Test timed out in 20000ms`, after 23.8 s |
| worktrees, "answers the branches a client types for" | 42760023503 | `Test timed out in 20000ms`, after 24.6 s |
| changes-refresh, "moves a worktree row at a tool call" | 42984895620 | `git worktree list --porcelain`: `fatal: failed to read .git/worktrees/s/commondir: No error` |

## Cause

Unknown.
Each `git` call is a new process, and a Windows runner is slow to start one. The first two cases make many calls in one run.
In the third case, the test's own `git worktree list` read the worktree folder while the host was still writing it.

Plan host/20261113-2331 fixes the third case: `openInTree` takes a `git` read that fails as a tree not there yet.

## Impact

A Windows CI job fails at random, and blocks a merge until it runs again.

## Workaround

None. Running the job again is not a fix.

## Fix

- Take the timings of each case on a Windows runner, and count its `git` calls.
- In the third case, wait for the host to say the worktree exists before the test reads it with `git`.
