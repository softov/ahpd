---
title: A session's git directory is its folder's own
status: todo
depends: []
layer: "sdk, computer"
refs:
  - "[code://packages/sdk/src/repo/worktrees.ts#L75-L94](../../../../packages/sdk/src/repo/worktrees.ts#L75-L94) - `gitDir` takes git's answer as it is"
  - "[code://packages/sdk/src/host/machines.ts#L172-L187](../../../../packages/sdk/src/host/machines.ts#L172-L187) - `repositoryOf` passes it on"
  - "[code://packages/computer/src/gitdir.ts#L83-L95](../../../../packages/computer/src/gitdir.ts#L83-L95) - `entryOf`, which already checks a `.git` file's entry is under `<gitDir>/worktrees`"
  - "[code://packages/computer/src/gitdir.ts#L115-L125](../../../../packages/computer/src/gitdir.ts#L115-L125) - `gitMounts` makes `hooks/`, `worktrees/` and `modules/` in whatever directory it is given"
---

## Objective

A machine is given a git directory only when it is the session folder's own: `<root>/.git` with no `commondir` file in it, or, for a linked worktree, the common directory whose `worktrees/<name>` the root's `.git` file names and whose `gitdir` file names that `.git` back.
Anything else is refused with a sentence naming the path, and nothing is made in it.

## Files

- `UPDATE: packages/computer/src/gitdir.ts:83-125` - the check, before anything is made; today a later session's `git rev-parse --git-common-dir` answers whatever a `commondir` in the folder's `.git` (or a fake `.git` directory with one) names, so another repository on the host is mounted read-write and `gitMounts` makes `hooks/`, `worktrees/` and `modules/` inside it.
- `UPDATE: packages/sdk/src/repo/worktrees.ts:75-94` - also ask `--absolute-git-dir`, so the caller sees both the per-worktree and the common directory.
- `UPDATE: packages/sdk/src/host/machines.ts:172-187` - a refusal is logged with the path and passes no `gitDir`, as a `rev-parse` failure does today.
- `UPDATE: packages/computer/test/computer-disposable.test.ts` - the cases below.

## Steps

1. Failing case first: a repository `a` the session runs in, and a repository `b` beside it; write `a/.git/commondir` naming `b/.git`, then make a machine for a session in `a`. Today `b/.git` is mounted read-write and `b/.git/hooks`, `worktrees`, `modules` are made; after, the machine has no git directory, the log names `a/.git/commondir`, and nothing is made in `b`.
2. A second case: the session folder holds a `.git` directory with only a `commondir` naming `b/.git`; the same refusal.
3. A linked worktree made by `git worktree add` still gets its common directory (passes before and after).
4. Where the host recorded the repository a worktree session was isolated from (`worktrees.get(uri).repository`), the common directory must be `<that repository>/.git` as well.

## Validation

- The cases in steps 1 and 2 fail on `e1c4ccc` and pass after.
- `pnpm exec vitest run packages/computer/test/computer-disposable.test.ts packages/sdk/test/worktrees.test.ts`.

## Resume
