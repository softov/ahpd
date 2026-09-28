---
title: A session outside the configured paths has its git facts and its changes without waiting for a turn - implemented
date: 2026-09-28
refs:
  - git://1e788bd
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `readFacts`, `readStored` and `summaryMoved`"
---

A session whose folder is outside the host's configured paths shows its change counts and offers Create PR as soon as a client looks, not only after its next turn ends.

## What was built

- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `readFacts(dir)` reads the git facts, the pull requests and the changes side by side and resolves when done; `refreshFacts` and the changeset subscribe call it; `readStored` reads each stored session's folder outside `browsable()` once after startup; `summaryMoved` carries a listed row's `changes`.

## Verified

- `packages/sdk/test/changes-refresh.test.ts`, seven cases with a scratch repository outside the host's `path`: Create PR and the counts on the first subscribe, a folder that is not a repository, and a stored session's counts in `listSessions` and announced to a client already connected; each fix case fails with its change reverted.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.
- Reviewed by Softov on 2026-09-28.

## Departures from the plan

- `readStored` is started by a `setTimeout(..., 0)` after `listing`, not after the `browsable()` loop, because `listing` is defined later in `createHost`.

## Left for later

- none.
