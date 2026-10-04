---
title: A tool call says when it started and how long it ran, live and in history - implemented
---

## What exists

- Every backend stamps its tool calls with `ahpd.startedAt`, `ahpd.endedAt` and `ahpd.durationMs` through the sdk helper; see the children.

## Verified

- After rebasing onto `5c0adf6`: `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (174 files, 2671 tests) pass.
