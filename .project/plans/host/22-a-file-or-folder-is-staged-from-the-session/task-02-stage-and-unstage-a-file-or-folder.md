---
title: A file or a folder is staged and unstaged
status: done
depends: [task-01-a-target-stays-inside-the-folder.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/changes.ts#L212-L238](../../../../packages/sdk/src/changes.ts#L212-L238) - `DISCARD`, `STAGE` and `UNSTAGE`"
  - "[code://packages/sdk/src/changes.ts#L928-L936](../../../../packages/sdk/src/changes.ts#L928-L936) - what the uncommitted scope offers"
  - "[code://packages/sdk/src/changes.ts#L79-L86](../../../../packages/sdk/src/changes.ts#L79-L86) - `indexHolds`, which handles a repository with no commit yet"
  - "[code://packages/sdk/src/changes.ts#L1044-L1063](../../../../packages/sdk/src/changes.ts#L1044-L1063) - the `stage` and `unstage` branches of `invoke`"
---

## Objective

The uncommitted changeset offers `stage` and `unstage` as resource-scoped operations; each takes a file or a folder inside the session's folder, the folder itself meaning everything, and after it the rows' `_meta.staged` and Commit's confirmation say what the index now holds.

## Files

- `UPDATE: packages/sdk/src/changes.ts` - `STAGE` and `UNSTAGE`, offered beside `DISCARD` when the changeset is dirty, and their branch in `invoke`.
- `UPDATE: packages/sdk/test/commit.test.ts` - the cases below.
- `UPDATE: packages/sdk/test/pullrequest.test.ts` - the operation list the pull request cases assert, which now holds the two new ids.

## Steps

1. `STAGE`: id `stage`, label "Stage Changes", scopes `['resource']`, icon `add`, group `stage`, no `confirmation`, since staging destroys nothing. `UNSTAGE`: id `unstage`, label "Unstage Changes", icon `remove`, group `stage`, no `confirmation`.
2. `stage` runs `git add -A -- <path>`, which takes new, changed and deleted files under a folder.
3. `unstage` runs `git restore --staged -- <path>`; in a repository with no commit yet, `git rm --cached -r -q -- <path>`.
4. Each is harmless on a path with nothing to move: git's own no-op, and no error.
5. Invoke's usual refresh then moves the rows and re-declares Commit.

## Validation

- `commit.test.ts`, in a scratch repository with `a.txt` and `b.txt` changed and `new/c.txt` untracked: `stage` on `a.txt` stages only it; `stage` on `new/` stages `c.txt`; `stage` on the folder stages all three; `unstage` on the folder unstages all three; `unstage` on `a.txt` alone leaves the others as they were.
- After `stage` on `a.txt`, Commit's confirmation is "Commit 1 staged file as '...'?".
- `stage` on a clean file answers without an error.
- `unstage` in a repository with no commit yet unstages.
- Today `operations` offers neither.
- `node_modules/.bin/vitest run packages/sdk/test/commit.test.ts` green.

## Resume

Implemented 2026-09-27. `STAGE` and `UNSTAGE` are declared with the ids, labels, `resource` scope, icons, `stage` group and no `confirmation` the task names, and are offered beside `DISCARD` when the changeset is dirty. `stage` runs `git add -A -- <path>` and `unstage` runs `git restore --staged -- <path>`, or `git rm --cached -r -q -- <path>` when `HEAD` does not resolve yet; both answer with the path they moved.

What failed first, in `commit.test.ts`: the five new cases, four with "No operation called stage" or "No operation called unstage" and the offer case because `operations` listed neither id. After the change: `stage` on `a.txt` stages only it and Commit's confirmation is "Commit 1 staged file as 'Fix the build'?", `stage` on `new/` stages `c.txt`, `stage` on the folder stages all three, `unstage` on `a.txt` leaves the others staged, `unstage` on the folder clears the index, a clean file answers without an error, and a repository with no commit unstages. `commit.test.ts` is 17 of 17 green.

Departure from Files: adding two operations to the uncommitted scope broke `pullrequest.test.ts`'s expected id list, so its four assertions now name `stage` and `unstage`; without that the suite is red and the list is wrong.

The declaration has no `description` and no `writes`, because the task's step 1 names neither and `writes` says whether a run writes the working tree, which staging does not.

Review 2026-09-27: `STAGE` and `UNSTAGE` gained a `description`, as `DISCARD` has one.
