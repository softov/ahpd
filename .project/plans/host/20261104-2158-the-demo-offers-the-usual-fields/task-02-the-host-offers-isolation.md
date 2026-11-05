---
title: The demo host offers isolation and branch
status: done
depends: []
layer: "examples"
refs:
  - "[code://examples/demo/main.ts](../../../../examples/demo/main.ts) - the `createHost` options"
  - "[code://packages/sdk/src/repo/worktrees.ts#L93](../../../../packages/sdk/src/repo/worktrees.ts#L93) - `gitWorktrees()`"
  - "[code://packages/sdk/src/host/sessionconfig.ts#L76-L107](../../../../packages/sdk/src/host/sessionconfig.ts#L76-L107) - the fields the port turns on"
---

## Objective

A new session in a git folder on the demo host offers `Isolation` and `Branch`, as on the daemon.

## Files

- `UPDATE: examples/demo/main.ts` - `worktrees: gitWorktrees()` in the host options.
- `UPDATE: examples/demo/README.md` - a row for worktrees.

## Steps

1. Import `gitWorktrees` from `@ahpd/sdk` in `examples/demo/main.ts`.
2. Pass `worktrees: gitWorktrees()` to `createHost`.
3. Add a README row: a git folder offers isolation and branch, and a worktree goes beside its repository.

## Validation

- Run `pnpm demo` with `--path` on a folder with a git repository.
- Run `ahpc session config` on a new session there, and check that it lists `isolation` and `branch`.

## Resume
