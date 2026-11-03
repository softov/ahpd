---
title: The locations are read whole
status: todo
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/spawn.ts#L964-L969](../../../../packages/sdk/src/host/spawn.ts#L964-L969) - the command check's read"
---

## Objective

The command check reads a session's `sensitiveEditLocations` whole.
A value whose every entry fits the property's shape is the locations, and any other value is none.

## Files

- `UPDATE: packages/sdk/src/host/spawn.ts:964-969` - the value held to the property's shape whole.
- `UPDATE: packages/sdk/test/autoapproval.test.ts:259-290` - a value with one malformed entry.
- `UPDATE: docs/sdk/AHP.md` - the `session/configChanged` row.

## Steps

1. Take the session's value as the locations only where every entry fits.
2. Read any other value as no locations.
3. Add the case of a value with one malformed entry beside a good one.
4. Describe the read in the `session/configChanged` row.

## Validation

- `packages/sdk/test/autoapproval.test.ts`: the new case fails on `cde4dd6c` and passes after.
- The autoapproval and command approver test files pass.
- `pnpm run typecheck` is clean.

## Resume

Not started.
