---
title: A write-only value is masked
status: todo
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

- `UPDATE: packages/sdk/src/channels/owners.ts` - `writeOnlyPaths(schema, config)`, the path of every non-empty value whose node says `writeOnly`, walked as `secretPaths` walks.
- `UPDATE: packages/sdk/src/connectors/channel.ts:389-392` - `connectorRow` puts `HELD` at each path `writeOnlyPaths` gives for the record's adapter schema.
- `UPDATE: packages/sdk/src/plugins/validate.ts:88-110` - `writeOnlyGaps` takes whether the schema's secrets are top-level, and gives a nested node of such a schema a reason that says the value is masked and stays in the record.
- `UPDATE: packages/sdk/test/connector-fields.test.ts` - cases for a top-level and a nested `writeOnly` field with `secret: false`.
- `UPDATE: packages/sdk/test` - a case for the new warning reason, in the file that tests `WRITEOUT_IN_VAULT` today.

## Steps

1. Add `writeOnlyPaths` beside `secretPaths`, and export it.
2. In `connectorRow`, read the adapter's schema, and replace each value at a `writeOnlyPaths` path with `HELD`.
3. Give `writeOnlyGaps` a `topLevel` flag, and call it with `true` for an adapter and a tunnel kind.
4. With the flag, keep `WRITEOUT_IN_VAULT` for a top-level node, and give a nested node the new reason.
5. Add the row cases and the warning case.

## Validation

- The new cases fail without the change and pass with it.
- `pnpm --filter @ahpd/sdk test` passes, run alone.

## Resume
