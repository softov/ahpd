---
title: The machine's repository is seeded from the host's
status: todo
depends: [task-02-a-machine-gets-a-git-directory-of-its-own.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L1655-L1660](../../../../packages/computer/src/runtime.ts#L1655-L1660) - `seedState`, a volume owned by the machine's user"
  - "[code://packages/computer/src/runtime.ts#L2179-L2204](../../../../packages/computer/src/runtime.ts#L2179-L2204) - `exec` as the labelled user, and the dev container road"
  - "[code://packages/sdk/src/repo/hardened.ts#L11-L30](../../../../packages/sdk/src/repo/hardened.ts#L11-L30) - the argv for the host-side reads"
---

## Objective

Once the machine is up, its git directory is a repository whose objects come from the host's through `objects/info/alternates`, whose branch is the one checked out in the host's tree at the same commit, whose index matches that commit, and whose config holds only the host's `user.name` and `user.email`.

## Files

- `UPDATE: packages/computer/src/gitdir.ts` - `seedOf(gitDir, root)`: the host-side reads, with the hardened argv: `symbolic-ref -q HEAD`, `rev-parse HEAD`, `config --get user.name`, `config --get user.email`.
- `UPDATE: packages/computer/src/runtime.ts` - after the container is up, on both routes, as the machine's user: `git init` at the volume's target, `objects/info/alternates` naming `<gitDir>/objects`, `update-ref` of the branch, `symbolic-ref HEAD` (or a detached `HEAD`), the two config values, `reset -q`. The volume is owned by the machine's user before this, as `seedState` does.
- `UPDATE: packages/sdk/src/index.ts` - export `gitArgv`, so the computer package runs host git the same way.
- `UPDATE: packages/computer/test/computer-git-fetch.test.ts` - the cases below.

## Steps

1. Failing case first, real Docker: `git status` in the machine is clean right after it is made; with an empty volume it is not a repository.
2. Read the host's side, then seed through the machine's own git; nothing on the host is written.
3. A seed that fails removes the machine and answers git's words.

## Validation

- `computer-git-fetch.test.ts`: on a linked worktree and on a main checkout, the machine's `git status` is clean, `git log -1` is the host's commit, `git branch --show-current` is the host's branch; a detached host HEAD gives a detached machine; the machine's `git config --list --local` holds `user.name` and `user.email` and no remote.
- `npx vitest run packages/computer` passes.

## Resume
