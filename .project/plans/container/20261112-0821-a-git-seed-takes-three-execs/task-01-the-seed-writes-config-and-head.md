---
title: The seed writes config and HEAD
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L2286-L2368](../../../../packages/computer/src/runtime.ts#L2286-L2368) - `seedGit`"
  - "[code://packages/computer/src/machinegit.ts#L123-L152](../../../../packages/computer/src/machinegit.ts#L123-L152) - `checkedOut`"
---

## Objective

The seed writes the git `config` and `HEAD` in one `docker cp -a` archive, and runs only `init --bare`, `update-ref` and `reset` as git execs.

## Files

- `UPDATE: packages/computer/src/runtime.ts:2286-2368` - `seedGit` adds `config` and `HEAD` to the alternates archive and drops `config core.bare`.
- `UPDATE: packages/computer/src/runtime.ts:2251-2261` - `idsOfMachine` reads uid and gid from one `id` call.
- `UPDATE: packages/computer/src/machinegit.ts:123-152` - `checkedOut` drops the `config` and `symbolic-ref` calls.
- `UPDATE: packages/computer/test/` - cases that read back the config and `HEAD`, and count the execs.

## Steps

1. Write a function `gitConfigOf` that returns the config text with `core.bare`, `user.name`, `user.email`, `core.filemode` and `core.autocrlf`.
2. Add `config` from `gitConfigOf` and `HEAD` as `ref: refs/heads/<branch>` to the archive in `seedGit`.
3. Remove `config core.bare false` from `seedGit`.
4. Remove the four `config` calls and `symbolic-ref` from `checkedOut`.
5. Read uid and gid in `idsOfMachine` from one `id` call.
6. Write the cases that read back `git config --list` and `HEAD`, and count the execs.

## Validation

- The new cases match the config and `HEAD` that the old seed made.
- The exec count for a seed is at most three git execs and one `docker cp`.
- `pnpm typecheck` and the computer suite pass.

## Resume
