---
title: VS Code opens the uncommitted changes first - implemented
date: 2026-10-09
refs:
  - "[code://packages/sdk/src/changes.ts#L856-L873](../../../../packages/sdk/src/changes.ts#L856-L873)"
  - "[code://packages/sdk/test/changes-uris.test.ts](../../../../packages/sdk/test/changes-uris.test.ts)"
---

A session's changesets list the working tree first, so VS Code opens it and offers Commit there.
"This Session" stays in the picker, second.

## What was built

- [`code://packages/sdk/src/changes.ts`](../../../../packages/sdk/src/changes.ts) - `scopes()` lists `uncommitted`, then `session`, then the two templates.
- [`code://packages/sdk/test/changes-uris.test.ts`](../../../../packages/sdk/test/changes-uris.test.ts) - a case that asserts that order for a session with a turn.

## Verified

- The builder's gates passed with 263 files and 4606 tests.
- In the review worktree on main `cf12de4`: typecheck is clean, and the changes, commit, wire and operations tests pass, 101 tests.
- `commit` on a dirty `uncommitted` entry is the code that was there before, at `changes.ts` `operations`.

## Departures from the plan

- The task named `packages/sdk/test/changes.test.ts`, which no longer exists; the case is in `changes-uris.test.ts`.

## Left for later

- Softov checks in VS Code that the Changes view opens on the working tree and shows Commit.
