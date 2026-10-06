---
title: The manifest says its choices
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/policies.ts#L21-L53](../../../../packages/sdk/src/policies.ts#L21-L53) - the tables, exported"
  - "[code://packages/sdk/src/policy.ts#L71-L150](../../../../packages/sdk/src/policy.ts#L71-L150) - the manifest, built from them"
  - "[code://packages/sdk/test/policy-scheme.test.ts#L175-L278](../../../../packages/sdk/test/policy-scheme.test.ts#L175-L278) - the manifest test and the cases this task added"
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

Implemented 2026-10-06.
The three cases were written first and failed on the code as it was: `KINDS is not iterable` and `Cannot read properties of undefined (reading 'length')`, because the tables were module-private and there was no `allOf`, and `expected true to be false` on a `computer` row whose limit is in `usd`, which the manifest accepted.
`MEASURES`, `MATCHES`, `PERIODS`, `KINDS`, `EFFECTS` and `LIMIT_POOLS` are exported and nothing else in `policies.ts` changed.
`policy.ts` builds `choice()` fields and `narrowed`, one `allOf` entry per kind, from them; `ALL_MEASURES` is the union in the order the kinds name it.
Departures: `period` and the limit `pool` had no sentence to keep, their description was the value list alone, so each got the short sentence its type in `types/policies.ts` already carries. The test imports ajv's named `Ajv`, because the default import does not construct under `module: nodenext`.
`pnpm typecheck` is clean; `packages/sdk`'s `pnpm test` passes (1435 tests, one earlier run's timeout in `nested-proxy.test.ts` did not come back); `tsc -p packages/sdk` is clean.
