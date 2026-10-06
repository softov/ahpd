---
title: The host knows a folder's git directory and hands it on
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/repo/worktrees.ts#L58-L72](../../../../packages/sdk/src/repo/worktrees.ts#L58-L72) - `gitWorktrees`, `repository` at L60-L64"
  - "[code://packages/sdk/src/host/machines.ts#L182-L212](../../../../packages/sdk/src/host/machines.ts#L182-L212) - `placedIn`; the maker call at L201-L209"
  - "[code://packages/sdk/src/types/computers.ts#L84-L85](../../../../packages/sdk/src/types/computers.ts#L84-L85) - `folder`"
  - "[code://packages/sdk/src/types/worktrees.ts#L73-L112](../../../../packages/sdk/src/types/worktrees.ts#L73-L112) - the `Worktrees` port"
---

## Objective

`Worktrees.gitDir(dir)` answers the absolute common git directory and the repository's root, or nothing outside a repository, and `placedIn` passes them as `gitDir` and `repository` when they are not inside the folder.

## Files

- `UPDATE: packages/sdk/src/types/worktrees.ts` - `gitDir?(dir)`, optional so other ports need not have it.
- `UPDATE: packages/sdk/src/repo/worktrees.ts` - the git call.
- `UPDATE: packages/sdk/src/types/computers.ts:84-85` - `gitDir?` and `repository?` beside `folder`.
- `UPDATE: packages/sdk/src/host/machines.ts:182-212` - ask and pass, beside `folder` in the maker call, after `owner`, `team` and `project`.
- `UPDATE: packages/sdk/test/worktrees.test.ts` - the git call.
- `UPDATE: packages/sdk/test/host-files.test.ts` - what `placedIn` passes, beside `where the agent works` and `more than one directory`.

## Steps

1. `git rev-parse --path-format=absolute --git-common-dir --show-toplevel` in `dir`, five-second limit like `repository`.
2. Pass `gitDir` only when it does not start with `folder + '/'`; pass `repository` only when it is not `folder` itself, so a session in a subfolder names the root to mount.
3. A `rev-parse` that fails or times out passes neither and logs one line naming the folder and git's reason, so a session outside a repository is quiet only when git said so.
4. For a `devcontainer://<folder>` source the same call is made for that folder, the workspace the Dev Container CLI mounts, and the answer is passed the same way.

## Validation

- A real temporary repository with a linked worktree answers the main `.git`.
- The host passes `gitDir` for a worktree session and not for a session at the repository root; it passes `repository` for a session in `repo/src`.
- A `rev-parse` that fails (a folder git refuses) logs one line and passes neither.

## Resume

- Built 2026-10-06 on 08f046b.
- `Worktrees.gitDir?(dir)` answers `{ gitDir, repository }` from one `rev-parse --path-format=absolute --git-common-dir --show-toplevel` under five seconds; outside a repository it answers nothing, and any other refusal rejects in git's words.
- `placedIn` asks it through `repositoryOf` in `machines.ts`, for the `devcontainer://` folder when that is the source and the session's folder otherwise, compares against the folder as given and resolved, and spreads `gitDir` and `repository` beside `folder`.
- A rejection logs one line, `computers: no git directory for <folder>: <git's words>`, and passes neither.
- Tests: `packages/sdk/test/worktrees.test.ts` (4) and `packages/sdk/test/host-files.test.ts` (5), each failing first.
- Fix turn 2026-10-06: `gitDir` is passed inside the folder too, for `gitGuard: "bind"` to guard a root session; `repository` is still passed only below the root.
- Fix turn 2026-10-06: `repo/hardened.ts` `gitArgv` gives every host git run `-c core.fsmonitor= -c submodule.recurse=false` and `--ignore-submodules` where taken; `changes.ts`, `repo/git.ts` and `repo/worktrees.ts` use it; `packages/sdk/test/git-hardened.test.ts` (4) checks the argv through a fake `git` on `PATH`.
