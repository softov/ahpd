---
title: The daemon log rotates at start - implemented
date: 2026-10-02
refs:
  - "[code://packages/server/src/daemon.ts](../../../../packages/server/src/daemon.ts)"
---

`ahpd start` moves a `daemon.log` over 5 MB aside to `daemon.log.1` before the new daemon writes to it, so a long-lived host's log no longer grows without bound.

## What was built

- [`code://packages/server/src/daemon.ts`](../../../../packages/server/src/daemon.ts) - `rotateLog`, called from `start` after the config folder exists and before the child opens the log; one previous log is kept.

## Verified

- `pnpm exec tsc --noEmit` clean, `pnpm test` 151 files and 2212 tests, `pnpm boundary` clean.
- `packages/server/test/daemon.test.ts`: a log over 5 MB is moved aside and the new one holds the start; a log under the limit is appended to with no `.1`; an older `.1` is replaced.

## Departures from the plan

- none.

## Left for later

- none.
