---
title: The user file is written through a temp file of its own
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/users.ts#L672-L687](../../../../packages/sdk/src/users.ts#L672-L687) - `write`, whose temp name is `${options.path}.tmp`"
  - "[code://packages/server/src/daemon.ts#L125](../../../../packages/server/src/daemon.ts#L125) - the sweeper's `<file>.<pid>.tmp` form"
  - "[code://packages/sdk/test/users.test.ts](../../../../packages/sdk/test/users.test.ts) - the user directory's cases"
---

## Objective

Each process writing the user file writes through `${path}.${pid}.tmp`, so two writers never share one temp file and one never renames the other's half-written bytes into place.

## Files

- `UPDATE: packages/sdk/src/users.ts:675` - `const loose = \`${options.path}.${String(process.pid)}.tmp\``; today `${options.path}.tmp`.
- `UPDATE: packages/sdk/test/users.test.ts` - one case.

## Steps

1. Change the temp name; keep the mode, the broken-file refusal and the rename.

## Validation

- Written first and seen failing (today the write fails with `EISDIR`): with a directory at the user file's path plus `.tmp`, `fileUsers(...).addTeam` succeeds and the file holds the team.
- The existing cases in `users.test.ts` stay green.
- `pnpm exec tsc --noEmit`, `pnpm test packages/sdk/test/users.test.ts`.

## Resume
