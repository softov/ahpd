---
title: A file or a folder is staged and unstaged from the session's changeset - implemented
date: 2026-09-28
refs:
  - git://59b96f2
  - "[code://packages/sdk/src/changes.ts](../../../../packages/sdk/src/changes.ts) - `pathIn`, `STAGE` and `UNSTAGE`"
---

A person stages and unstages from the session itself, a file or a whole folder, and Commit then takes exactly that; nothing above the session's folder can be named.

## What was built

- [`code://packages/sdk/src/changes.ts`](../../../../packages/sdk/src/changes.ts) - `pathIn` decodes a target, and requires both the written and the resolved path inside the session's folder, answering the written one; a folder is refused for `discard` and `revert`; `stage` runs `git add -A` and `unstage` runs `git restore --staged`, or `git rm --cached` before the first commit.
- [`code://docs/AHP.md`](../../../../docs/AHP.md) - how a person stages, in VS Code, ahpapp, a terminal or Source Control.

## Verified

- `packages/sdk/test/commit.test.ts`, 17 cases, in a scratch repository whose session folder is a subdirectory: `../`, `%2E%2E` and a symlink out are refused, a link inside is staged as the link, and a file, a folder and the whole session folder stage and unstage; each failed first.
- `packages/sdk/test/pullrequest.test.ts` names the two new operation ids.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.
- Reviewed by Softov on 2026-09-28.

## Departures from the plan

- `commit.test.ts` gained a generic `operate` helper, and `pullrequest.test.ts` changed, neither named in the task's Files.
- In review, `pathIn` stopped answering the path with symlinks followed, and `STAGE` and `UNSTAGE` gained a `description`.

## Left for later

- none.
