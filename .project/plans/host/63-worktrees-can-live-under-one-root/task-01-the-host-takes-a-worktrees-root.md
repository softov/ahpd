---
title: The host takes a worktrees root
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/repo/worktrees.ts#L31-L45](../../../../packages/sdk/src/repo/worktrees.ts#L31-L45) - `worktreesOf`, which gains the root"
  - "[code://packages/sdk/src/types/host.ts#L150-L164](../../../../packages/sdk/src/types/host.ts#L150-L164) - `worktrees`, beside which `worktreesRoot` is declared"
  - "[code://packages/sdk/src/host/lifecycle.ts#L612](../../../../packages/sdk/src/host/lifecycle.ts#L612) - the path a session's tree is given"
  - "[code://packages/sdk/src/host.ts#L27](../../../../packages/sdk/src/host.ts#L27) - an unused import of both helpers"
  - "[code://packages/sdk/test/worktrees.test.ts](../../../../packages/sdk/test/worktrees.test.ts) - the real-repository cases, beside which the root case sits"
---

## Objective

`createHost({ worktrees: gitWorktrees(), worktreesRoot })` makes a session's tree at `<worktreesRoot>/<repo>/<name>`, and without `worktreesRoot` at `<repo>.worktrees/<name>` as today.

## Files

- `UPDATE: packages/sdk/src/repo/worktrees.ts:31-41` - `worktreesOf(repository, root?)`, and its doc comment.
- `UPDATE: packages/sdk/src/types/host.ts:164` - `worktreesRoot?: string` after `worktrees`.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:612` - pass `options.worktreesRoot`.
- `UPDATE: packages/sdk/src/host.ts:27` - drop the unused import.
- `UPDATE: packages/sdk/test/worktrees.test.ts` - the root case.
- `UPDATE: packages/sdk/README.md:80` - the options table row.

## Steps

1. `worktreesOf(repository, root?)` returns `join(root, basename(repository))` when `root` is given and `<repo>.worktrees` beside the repository otherwise. The doc comment keeps why the default is beside and named as the reference names it, and says a root is this host's own departure from it, citing the decision.
2. `HostOptions.worktreesRoot?: string`, documented as an absolute folder every session tree goes under, as `<root>/<repo>/<name>`, and meaningless without `worktrees`.
3. `isolated` calls `worktreesOf(repository, options.worktreesRoot)`. Nothing else changes: the port's `create` already makes the parent folders through `git worktree add`; check that it does, and `mkdir -p` the parent in `create` if it does not.
4. Remove the unused import at `host.ts:27`.
5. The README options table gains a `worktreesRoot` row.

## Validation

- `packages/sdk/test/worktrees.test.ts`: a host given `worktreesRoot` in a temporary folder makes a session's tree at `<root>/<repo>/<name>`, and it is a worktree of the repository (`git worktree list` names it).
- The existing cases unchanged: a host with no root still makes `<repo>.worktrees/<name>`.
- `pnpm exec vitest run packages/sdk/test/worktrees.test.ts`, `pnpm typecheck`, `pnpm boundary`.

## Resume
