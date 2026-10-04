---
title: The git, GitHub and worktree ports live in repo/
status: done
depends: [task-02-facts.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/git.ts](../../../../packages/sdk/src/git.ts) - `gitBranches`, the `directories` port"
  - "[code://packages/sdk/src/github.ts](../../../../packages/sdk/src/github.ts) - `githubPullRequests`, the `github` port"
  - "[code://packages/sdk/src/worktrees.ts](../../../../packages/sdk/src/worktrees.ts) - `gitWorktrees`, `worktreesOf`, `worktreeFor`, the `worktrees` port"
  - "[code://packages/sdk/src/index.ts#L35-L50](../../../../packages/sdk/src/index.ts#L35-L50) - the package exports of the three"
  - "[code://packages/sdk/src/host.ts#L30](../../../../packages/sdk/src/host.ts#L30) - the host's one import of `worktrees.ts`"
  - "[code://packages/computer/src/plugin.ts#L731](../../../../packages/computer/src/plugin.ts#L731) - `host.registerComputers`, the shape a later plan gives `repo/` as a plugin"
---

## Objective

`packages/sdk/src/repo/git.ts`, `repo/github.ts` and `repo/worktrees.ts` are the three files moved unchanged, every import points at them, and `@ahpd/sdk` exports `gitBranches`, `gitWorktrees`, `worktreesOf`, `worktreeFor` and `githubPullRequests` as before, so `packages/server` changes nothing.

## Files

- `CREATE: packages/sdk/src/repo/git.ts`, `repo/github.ts`, `repo/worktrees.ts` - `git mv` of the three files; their relative imports gain one `../`.
- `UPDATE: packages/sdk/src/index.ts:35`, `:49`, `:50` - `./repo/git.js`, `./repo/worktrees.js`, `./repo/github.js`.
- `UPDATE: packages/sdk/src/host.ts:30` - `./repo/worktrees.js`, or the file under `host/` that holds the import by then.
- `UPDATE: packages/sdk/test/git.test.ts`, `git-locks.test.ts`, `changes-refresh.test.ts`, `github.test.ts`, `worktrees.test.ts` - the import path only.

## Steps

1. `git mv` each file so history follows it; change nothing inside but the relative import paths.
2. `rg -n "(git|github|worktrees)\.js'" packages examples` and update every import of the three; the `types/github.ts` and `types/worktrees.ts` files are types, not these, and do not move.
3. `changes.ts` stays where it is: it is the host's changeset logic.
4. Check `packages/server` imports the three from `@ahpd/sdk` only, so it needs no change.

## Validation

- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- `git diff -M --stat` shows the three as renames with 100% similarity but for their import lines.

## Resume
