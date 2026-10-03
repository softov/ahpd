---
title: The machine cannot change what git runs on the host
status: todo
depends: [task-02-a-machine-mounts-the-git-directory.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L730](../../../../packages/computer/src/runtime.ts#L730) - the folder mount the git directory joins"
  - https://git-scm.com/docs/githooks - hooks in `$GIT_DIR/hooks` run on the host's next commit
  - https://git-scm.com/docs/git-config - `core.hooksPath`, `core.fsmonitor` and `core.sshCommand` name programs git runs
---

## Objective

Inside the machine, the repository's `hooks/` directory, its `config`, the whole `worktrees/` directory except the session's own entry, that entry's `config.worktree`, and the worktree's own `.git` file are read-only, so nothing the agent does in the machine makes git run a program on the host.
A crashed agent's `index.lock` in the session's own worktree entry is removed after the machine is gone.

## Files

- `UPDATE: packages/computer/src/runtime.ts` - read-only binds over the git directory mount on the Docker route; on the dev container route the same binds go through `overrideOf` (container/03 task 09), which is how container/03 delivers a read-only mount.
- `UPDATE: packages/computer/src/plugin.ts` - after the machine is removed, remove `<gitDir>/worktrees/<name>/index.lock`.
- `UPDATE: packages/computer/test/computer-disposable.test.ts`.

## Steps

1. After the read-write git directory mount, add `<gitDir>/hooks:<gitDir>/hooks:ro`, `<gitDir>/config:<gitDir>/config:ro`, `<gitDir>/worktrees:<gitDir>/worktrees:ro`, then the session's own `<gitDir>/worktrees/<name>` read-write over it, then `<gitDir>/worktrees/<name>/config.worktree` read-only over that, and the worktree's own `<folder>/.git` file read-only.
2. Before the machine is made, create on the host, empty, whatever of `hooks/` and the session's `config.worktree` is missing, so every bind has a source and git cannot make one inside.
3. No per-file bind for another worktree's `config.worktree`: the read-only `worktrees/` covers them, and a per-file bind of an entry pruned meanwhile would make Docker create a root-owned directory on the host.
4. The lock is removed only for the session's own worktree entry, never the main index, and only after the container is gone, so nothing in it can still hold it.

## Validation

- The fake's argv carries the binds in the order of step 1, and no bind names another worktree's entry.
- A session whose `config.worktree` did not exist has it created empty on the host before the machine is made.
- The lock is removed after the fake records the container's removal, and not before.
- By hand (Softov): inside the machine, writing `.git/hooks/pre-commit`, `git config core.hooksPath x`, `git config --worktree core.fsmonitor x`, editing another worktree's entry and editing the worktree's `.git` file all fail, and `git commit` still works.

## Resume
