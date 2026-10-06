---
title: The daemon reads the root
status: done
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

Implemented 2026-10-06.

- `serverFields.worktreesRoot` sits after `noCwd`: `type: 'string'`, `cli: { value: 'DIR' }`, and the description the step asked for. It is in neither `FILE_ONLY` nor `TYPED_ONLY`, so it is a flag and a `config.json` key at once, which is what the plan's second table says.
- `Options.worktreesRoot?: string` after `noCwd`, and `optionsFrom` answers `resolve(given('worktreesRoot'))` when the fold named one: absolute already when it came from a file, and the working directory when it was typed.
- `Config.worktreesRoot?: string` in `config.ts`, and `anchored` takes it with `users` and `connectionTokenFile`, so a relative value in a file is made absolute against the folder of the file that set it rather than against the working directory.
- `run.ts` spreads it into the `base` `HostOptions` only when it is set, beside `gitWorktrees()`.
- `docs/DAEMON.md`: the flag row after `--no-cwd`, `worktreesRoot` in the sentence about which keys a relative path is anchored against, and the key named in the list of what root config does not carry. `docs/AHP.md`: where a tree is made, in the first paragraph of "Worktrees the window manages".

Test first: three cases in `packages/server/test/config-layers.test.ts`, in its `a relative path` block. Two of them failed first on the unchanged code - `worktreesRoot` from a file answered `undefined`, and one typed on the line answered `undefined` - because there was no such key at all. The third, that absent stays absent, has nothing to fail against until the key exists; it is a guard on the resolution not inventing one, and it passes either way.

Not run: the by-hand check in Validation, `ahpd --worktrees-root ...` with a session in `/github/ahpd`. It starts a daemon, which this work was told not to do outside the tests. What it would show is covered by the sdk case in task 01 for the tree's path and by the two tests above for the daemon's reading of the key; the wiring between them, `run.ts` handing the option to `createHost`, is held by `pnpm typecheck` alone.

Gates: `pnpm exec vitest run packages/server/test/config-layers.test.ts` (17 passed), `pnpm typecheck`, `pnpm boundary`, `pnpm build` all pass. `pnpm test` is reported in `implemented.md`.
