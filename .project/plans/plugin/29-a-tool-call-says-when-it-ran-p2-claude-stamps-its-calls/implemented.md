---
title: Claude tool calls carry their start and end, live and restored - implemented
---

## What exists

- The Claude backend stamps a call when it starts, or at approval when it is asked about, and when it ends, live and in a restored transcript; a denied call carries no times, and a restored turn has a `duration`.

## Verified

- After rebasing onto `5c0adf6`: `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (174 files, 2671 tests) pass.
