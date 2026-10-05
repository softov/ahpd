---
title: The manifest says its choices
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/policies.ts#L22-L44](../../../../packages/sdk/src/policies.ts#L22-L44) - the tables to export"
  - "[code://packages/sdk/src/policy.ts#L64-L110](../../../../packages/sdk/src/policy.ts#L64-L110) - the manifest to build from them"
  - "[code://packages/sdk/test/policy-scheme.test.ts#L175-L186](../../../../packages/sdk/test/policy-scheme.test.ts#L175-L186) - the manifest test"
---

## Objective

The `policy:` manifest carries every choice a form offers, built from the tables `checkPolicy` uses.

## Files

- `UPDATE: packages/sdk/src/policies.ts:22-44` - export `MEASURES`, `MATCHES`, `PERIODS`, `KINDS`, `EFFECTS` and `LIMIT_POOLS`; nothing else changes.
- `UPDATE: packages/sdk/src/policy.ts:64-110` - build the manifest from those exports.
- `UPDATE: packages/sdk/test/policy-scheme.test.ts:175-186` - the cases below.

## Steps

1. `kind` gets `enum: KINDS`, `effect` gets `enum: EFFECTS`; in `limits.items`, `measure` gets `enum` of every measure in `MEASURES`, `period` gets `enum: PERIODS`, `pool` gets `enum: LIMIT_POOLS`.
2. The manifest gets `allOf`, one entry per kind: `if: { properties: { kind: { const: <kind> } }, required: ['kind'] }`, `then` narrows `limits.items.properties.measure.enum` to `MEASURES[<kind>]` and gives `match` `propertyNames: { enum: MATCHES[<kind>] }`.
3. Each description keeps its sentence and drops the value list it repeated; the `<maker>/<name>` and glob notes stay, since they are not lists of choices.

## Validation

- `policy-scheme.test.ts`: the enums equal the exported tables; ajv compiles the manifest; a valid body of each kind passes; a `computer` row with `measure: 'usd'`, and a `model` row whose match names `agent`, each fail.
- `npm test` in `packages/sdk` passes, and `npm run build` is clean.

## Resume
