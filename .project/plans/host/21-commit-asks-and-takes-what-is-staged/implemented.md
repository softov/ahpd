---
title: The commit operation asks first, and commits what is staged when anything is - implemented
date: 2026-09-28
refs:
  - git://59b96f2
  - "[code://packages/sdk/src/changes.ts](../../../../packages/sdk/src/changes.ts) - the status rows, `commit`, its `confirmation` and the git watch"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `refreshWatched`, `stopUnwatched` and the refresh triggers"
---

Commit from a session asks first, naming its subject and what it takes, and commits the index when anything is staged, so a person's staging in VS Code's Source Control decides what goes in.
The uncommitted changeset follows git, tool calls, client writes and terminals without waiting for a turn.

## What was built

- [`code://packages/sdk/src/changes.ts`](../../../../packages/sdk/src/changes.ts) - a row carries `_meta.staged` and `_meta.unstaged` and a staged rename is one row; `commit` takes the index when it differs from `HEAD`, else `add -A`; `commit` carries a `confirmation` built from the last look; `watch` follows the index, `HEAD`, the checked-out branch's ref and `packed-refs`, and a watcher error closes its handle.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `subject` moved to the operation context; one coalescing re-read per watched directory on the git watch, `chat/toolCallComplete`, client resource writes and `terminal/exited`; `stopUnwatched` closes a directory's watch when nobody watches it.
- [`code://docs/AHP.md`](../../../../docs/AHP.md) - what Commit takes and asks, the staging fields and the refresh triggers.

## Verified

- `packages/sdk/test/commit.test.ts` and `packages/sdk/test/changes-refresh.test.ts` (13 cases) in scratch repositories; every code case failed first, and task 08 showed the unwatched case fail without `watchedIn`.
- `pnpm test` 103 files, 1359 tests at task 04; `pnpm typecheck` and `pnpm boundary` green.
- Reviewed by Softov on 2026-09-28.

## Departures from the plan

- `_meta['ahp.commit'].files` is gone rather than kept; the index is what chooses the files.
- Tasks 06 to 08 were added in the 2026-09-27 review.

## Left for later

- none.
