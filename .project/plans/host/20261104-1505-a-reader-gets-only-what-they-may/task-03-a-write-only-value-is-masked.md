---
title: A write-only value is masked
status: done
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/connectors/channel.ts#L389-L392](../../../../packages/sdk/src/connectors/channel.ts#L389-L392) - `connectorRow`"
  - "[code://packages/sdk/src/channels/owners.ts#L144-L199](../../../../packages/sdk/src/channels/owners.ts#L144-L199) - `isSecret`, `secretFields` and `secretPaths`, whose walk task 03 copies"
  - "[code://packages/sdk/src/plugins/validate.ts#L88-L110](../../../../packages/sdk/src/plugins/validate.ts#L88-L110) - `writeOnlyGaps`"
---

## Objective

A connector row never holds a `writeOnly` value, and the load warning says what the host does with a nested `writeOnly` field.

## Files

- `UPDATE: packages/sdk/src/channels/owners.ts` - `writeOnlyHeld(schema, config)`, a copy of the config with `HELD` for each non-empty value whose node says `writeOnly`, walked as `secretPaths` walks.
- `UPDATE: packages/sdk/src/connectors/channel.ts:389-392` - `connectorRow` answers the config `writeOnlyHeld` gives for the record's adapter schema.
- `UPDATE: packages/sdk/src/plugins/validate.ts:88-110` - `writeOnlyGaps` takes whether the schema's secrets are top-level, and gives a nested node of such a schema a reason that says the value is masked and stays in the record.
- `UPDATE: packages/sdk/test/connectors-channel.test.ts` - a case for a top-level and a nested `writeOnly` field that stays in the record.
- `UPDATE: packages/sdk/test/schema-gaps.test.ts` - a case for the new warning reason.

## Steps

1. Add `writeOnlyHeld` beside `secretPaths`, and export it.
2. In `connectorRow`, read the adapter's schema, and answer the config through `writeOnlyHeld`.
3. Give `writeOnlyGaps` a `topLevel` flag, and call it with `true` for an adapter and a tunnel kind.
4. With the flag, keep `WRITEOUT_IN_VAULT` for a top-level node, and give a nested node the new reason.
5. Add the row cases and the warning case.

## Validation

- The new cases fail without the change and pass with it.
- `pnpm --filter @ahpd/sdk test` passes, run alone.

## Resume

- **Done so far:** every step.
- **Found:** the row mask is `writeOnlyHeld`, which returns a masked copy, not a list of paths. A path cannot reach a string inside a list. The warning case is in `packages/sdk/test/schema-gaps.test.ts`, and the row case in `packages/sdk/test/connectors-channel.test.ts`.
