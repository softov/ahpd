---
title: pi tool calls carry their start and end, live and restored - implemented
---

## What exists

- The pi backend stamps live calls at start or approval and at end, and replay stamps from each entry's `timestamp`; a person's own shell command is stamped too.

## Verified

- After rebasing onto `5c0adf6`: `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (174 files, 2671 tests) pass.
