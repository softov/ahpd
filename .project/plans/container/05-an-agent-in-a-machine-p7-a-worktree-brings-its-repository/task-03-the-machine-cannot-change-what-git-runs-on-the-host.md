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

Inside the machine, the repository's `hooks/` directory, its `config`, and every `worktrees/*/config.worktree` are read-only, so nothing the agent does in the machine makes git run a program on the host.
A crashed agent's `index.lock` in the session's own worktree entry is removed when the machine goes.

## Files

- `UPDATE: packages/computer/src/runtime.ts` - read-only binds over the git directory mount, on the Docker and dev container routes.
- `UPDATE: packages/computer/src/plugin.ts` - on dispose, remove `<gitDir>/worktrees/<name>/index.lock` when no process holds it.
- `UPDATE: packages/computer/test/computer-disposable.test.ts`.

## Steps

1. After the read-write git directory mount, add `<gitDir>/hooks:<gitDir>/hooks:ro` and `<gitDir>/config:<gitDir>/config:ro`, and the same for each `config.worktree` that exists.
2. A missing `hooks/` is created on the host first, empty, so the bind has a source.
3. The lock is removed only for the session's own worktree entry, never the main index.

## Validation

- The fake's argv carries each read-only bind after the git directory mount.
- By hand: inside the machine, writing `.git/hooks/pre-commit` and `git config core.hooksPath x` both fail, and `git commit` still works.

## Resume
