---
title: cofold tool calls carry their start and end live too, and restored calls keep their kind - implemented
---

## What exists

- The cofold backend stamps live calls and restored ones under the prefixed names; its `ahpd.durationMs` is cofold's own measure, and a restored call with no `tool.started` starts at its end minus that duration.

## Verified

- After rebasing onto `5c0adf6`: `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (174 files, 2671 tests) pass.
