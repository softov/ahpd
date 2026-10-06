---
title: The daemon reads the root
status: todo
depends: [task-01-the-host-takes-a-worktrees-root.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/options.ts#L277-L330](../../../../packages/server/src/commands/options.ts#L277-L330) - `serverFields`, where `paths` is the shape to copy"
  - "[code://packages/server/src/commands/run.ts#L460-L490](../../../../packages/server/src/commands/run.ts#L460-L490) - the `createHost` call"
  - "[code://docs/DAEMON.md#L261-L265](../../../../docs/DAEMON.md#L261-L265) - the flag table"
  - "[code://docs/AHP.md#L697-L720](../../../../docs/AHP.md#L697-L720) - what a new tree is, where its location is said"
---

## Objective

`worktreesRoot` in the daemon's config file, or `--worktrees-root <dir>`, reaches `createHost` as an absolute folder, and the docs say where a session's tree goes with and without it.

## Files

- `UPDATE: packages/server/src/commands/options.ts:277-330` - the `worktreesRoot` field.
- `UPDATE: packages/server/src/commands/run.ts:482` - `worktreesRoot` handed to `createHost` when set.
- `UPDATE: docs/DAEMON.md:261-265` - the flag row and the config key.
- `UPDATE: docs/AHP.md:697-720` - where a tree is made.
- `UPDATE: packages/server/test/` - the options test that covers `paths`.

## Steps

1. `serverFields.worktreesRoot`: `type: 'string'`, `cli: { value: 'DIR' }`, description "Keep every session worktree under this folder, as <dir>/<repo>/<name>. Default: <repo>.worktrees beside each repository."
2. Resolve it to an absolute path the way `paths` is resolved, the file's value against the file's folder and the flag's against the working directory.
3. `run.ts` spreads `worktreesRoot` into the `createHost` options only when it is set.
4. `docs/DAEMON.md` gains the flag row. `docs/AHP.md` says a new tree is made at `<repo>.worktrees/<name>`, the reference's location, or under `--worktrees-root` when the daemon was given one, and that VS Code's host finds a tree only at the default.

## Validation

- The options test: `--worktrees-root rel` resolves against the working directory, the file key against the file's folder, and absent stays absent.
- `pnpm test`, `pnpm typecheck`, `pnpm boundary`, `pnpm build`.
- By hand: `ahpd --worktrees-root /github/.worktrees`, a session with `isolation: worktree` in `/github/ahpd`, and its tree at `/github/.worktrees/ahpd/agents-<id8>`.

## Resume
