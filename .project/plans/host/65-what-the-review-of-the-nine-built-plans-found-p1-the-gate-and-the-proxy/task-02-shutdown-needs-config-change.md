---
title: shutdown needs config:change
status: done
depends: [task-01-a-method-in-neither-table-is-refused.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/gate.ts#L82-L86](../../../../packages/sdk/src/host/gate.ts#L82-L86) - the diagnostics rows of `NEEDS`"
  - "[code://packages/sdk/src/host/vscodemethods.ts#L325-L330](../../../../packages/sdk/src/host/vscodemethods.ts#L325-L330) - `shutdown`"
  - "[code://packages/sdk/src/host/vscodemethods.ts#L348](../../../../packages/sdk/src/host/vscodemethods.ts#L348) - `getManagedSettingsDiagnostics`"
  - "[code://packages/server/src/commands/run.ts#L633](../../../../packages/server/src/commands/run.ts#L633) - `shutdown` is `SIGTERM`"
---

## Objective

`shutdown` needs `config:change` and `getManagedSettingsDiagnostics` needs `diagnostics:network`, so every served method is in a table (decision [shutdown-needs-config-change](../../../decisions/shutdown-needs-config-change.md)).

## Files

- `UPDATE: packages/sdk/src/host/gate.ts:82-86` - `shutdown: 'config:change'` and `getManagedSettingsDiagnostics: 'diagnostics:network'`; today neither has a row, so before task 01 both are served to anyone and after it both are refused to all but the root connection.
- `UPDATE: packages/sdk/test/users-gate-commands.test.ts` - the cases below.

## Steps

1. Failing case first: a `member` sends `shutdown`; today it is served and the spy is called, after it is refused `-32009` and the spy is not.
2. A role holding `config:change` sends it and the spy is called; the root connection sends it and the spy is called.
3. A `guest` asks `getManagedSettingsDiagnostics` and is refused; a role holding `diagnostics:network` gets `[]`.
4. Add the two rows, with one comment line naming the decision for `shutdown`.

## Validation

- The `member` and `guest` cases fail on `e1c4ccc` and pass after; task 01's classification test passes.
- `pnpm exec vitest run packages/sdk/test/users-gate-*.test.ts`.

## Resume
