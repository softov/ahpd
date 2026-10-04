---
title: The sdk has one helper that builds and keeps a tool call's timing _meta - implemented
---

## What exists

- `packages/sdk/src/timing.ts`: `callTimes`, `withCallTimes` and `startOf`, exported from the sdk, write `ahpd.startedAt`, `ahpd.endedAt` and `ahpd.durationMs` into a call's `_meta` beside the keys it already has.

## Verified

- After rebasing onto `5c0adf6`: `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (174 files, 2671 tests) pass.
