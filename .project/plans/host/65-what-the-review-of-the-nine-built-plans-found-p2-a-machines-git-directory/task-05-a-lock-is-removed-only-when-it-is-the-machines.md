---
title: A lock is removed only when it is the machine's
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/gitdir.ts#L190-L203](../../../../packages/computer/src/gitdir.ts#L190-L203) - `releaseLock` removes `index.lock` unconditionally"
  - "[code://packages/computer/src/runtime.ts#L2164-L2171](../../../../packages/computer/src/runtime.ts#L2164-L2171) - `remove` calls it after `rm -f`"
---

## Objective

After a machine is removed, its worktree entry's `index.lock` is removed only when the lock's modification time is before the machine stopped; a lock made after that is host git's and stays.

## Files

- `UPDATE: packages/computer/src/gitdir.ts:190-203` - `releaseLock(entry, before, log)` compares the lock's `mtime` with `before`; today it removes the lock whoever holds it, so ahpd's own `git status` on the host, or a person's `git commit` in the worktree, can lose its lock mid-write and two writers then race on the index.
- `UPDATE: packages/computer/src/runtime.ts:2164-2171` - `remove` reads the container's `State.FinishedAt` (or the time it began removing a running one) from the record it already inspects, and passes it.
- `UPDATE: packages/computer/test/computer-disposable.test.ts` - the cases below.

## Steps

1. Failing case first: an entry with an `index.lock` whose `mtime` is after the machine's stop; `remove` the machine. Today the lock is gone; after, it is there.
2. A lock older than the stop is removed (passes before and after).

## Validation

- The case in step 1 fails on `e1c4ccc` and passes after.
- `pnpm exec vitest run packages/computer/test/computer-disposable.test.ts`.

## Resume
