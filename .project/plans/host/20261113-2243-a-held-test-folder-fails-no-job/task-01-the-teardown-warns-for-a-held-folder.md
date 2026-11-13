---
title: The teardown warns for a held folder
status: implemented
depends: []
layer: "tools"
refs:
  - "[code://tools/test-tmpdir.ts](../../../../tools/test-tmpdir.ts) - the teardown"
---

## Objective

The global teardown removes the run's folder with more retries. A folder a process still holds is a warning that names it, and any other error still throws.

## Files

- `UPDATE: tools/test-tmpdir.ts` - the removal is caught, and `EBUSY`, `EPERM` and `ENOTEMPTY` are warned about.

## Steps

1. Raise the removal's retries to 10, 200 ms apart.
2. Catch the removal's error. Throw it again unless its code is `EBUSY`, `EPERM` or `ENOTEMPTY`.
3. For those codes, write one line that names the folder and the code.

## Validation

- A suite run ends with the run's folder gone.
- `pnpm typecheck` passes.

## Resume

Implemented 2026-11-13. See [implemented.md](implemented.md).
