---
title: ACP tool calls carry their start and end while the daemon runs - implemented
---

## What exists

- The ACP backend stamps a call at the receive time of the first `session/update` about it and at the update that ends it. Receive times are kept in memory only, so a call replayed by `session/load` after a restart carries no times.

## Verified

- After rebasing onto `5c0adf6`: `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (174 files, 2671 tests) pass.
