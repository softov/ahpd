---
title: Two Windows cases wait on what they read - implemented
date: 2026-11-13
refs:
  - "[code://packages/sdk/test/host-tools.test.ts](../../../../packages/sdk/test/host-tools.test.ts)"
  - "[code://packages/sdk/test/changes-refresh.test.ts](../../../../packages/sdk/test/changes-refresh.test.ts)"
---

The dropped-client case reads a call's owner inside a window a `settle` cannot outlast. `openInTree` waits through a `git` read that fails on a tree the host is still writing.

## What was built

- The dropped-client case's window is 1000 ms.
- `openInTree` polls a read that answers `false` when `git worktree list` fails.
- The dropped-client problem file is deleted, and the git-cases problem file says its third case is fixed.

## Verified

- `npx vitest run packages/sdk/test/host-tools.test.ts -t "readied first"`: passed twice, in about 1.2 s.
- `npx vitest run packages/sdk/test/changes-refresh.test.ts -t "moves a worktree row"`: passed.

## Departures from the plan

- None.

## Left for later

- The first two git cases, which wait for timings on a Windows runner.
