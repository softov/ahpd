---
title: create_session works with no git
status: implemented
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/tools/session.ts#L506-L585](../../../../packages/sdk/src/tools/session.ts#L506-L585) - `create_session`"
---

## Objective

`create_session` with `worktree` left out makes the session in a folder that is not a git repository, as VS Code does.

## Files

- `UPDATE: packages/sdk/src/tools/session.ts:506-585` - the isolation picked when `worktree` is left out.
- `UPDATE: packages/sdk/test` - a case in a folder with no git.

## Steps

1. Pick the folder isolation when the input has no `worktree` and the folder has no git.
2. Keep the refusal when `worktree: true` names a folder with no git.

## Validation

- A folder with no git and no `worktree` makes a session there.
- The tool refuses `worktree: true` in that folder.
- `pnpm typecheck`, then the sdk suite.

## Resume

Implemented 2026-11-10. `create_session` asks the host what a folder takes, through a new `ToolCall.isolation(directory)`. It picks that answer when `worktree` is left out and the folder is not the caller's own. A folder with no git therefore gets `folder`, where the host used to fold the tool's `worktree` to it silently. `worktree: true` in that folder is refused with `Invalid create_session input: <folder> is not a git repository, so it has no worktrees.`, which keeps the host's sentence. The reader is `isolationOf` in `packages/sdk/src/host/tooling.ts`, wired into `toolContext` and `sessionlessContext`. It reads `ctx.isolating`, and answers `undefined` where the host offers no isolation, as with no worktrees port. The tool's `worktree` default stands there. `packages/sdk/src/types/host.ts` declares the member; those two files are beyond this task's Files. `packages/sdk/test/host-tools.test.ts` has both cases, each in a folder with no git, and the worktree-driven host they need. Gate: typecheck clean. The sdk suite passed 4625 and failed 1, `watches.test.ts > honours the excludes it was given`, the prescribed `TMPDIR` failure task 01 records.
