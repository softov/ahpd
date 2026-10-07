---
title: The approve-everything key is declared
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/root.ts#L162-L208](../../../../packages/sdk/src/host/root.ts#L162-L208) - `ROOT_CONFIG_SCHEMA`"
  - "[code://packages/sdk/src/host/trust.ts#L163](../../../../packages/sdk/src/host/trust.ts#L163) - `autoApproved`"
---

## Objective

`globalAutoApproveEnabled` is in the root config schema, so a client can see it and turn it off.

## Files

- `UPDATE: packages/sdk/src/host/root.ts:162-208` - declare the key.
- `UPDATE: packages/sdk/test/` - the case below, in the root config tests.

## Steps

1. Declare `globalAutoApproveEnabled` as a boolean with default `false`.
2. Give it the title "Approve Everything" and a one-sentence description for a person.

## Validation

- `it('lists globalAutoApproveEnabled in the root config schema with default false')`
- Run the full gates from the plan. All pass.

## Resume

