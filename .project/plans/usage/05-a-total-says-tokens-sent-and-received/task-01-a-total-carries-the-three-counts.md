---
title: A total carries the three counts
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/usage.ts#L90-L108](../../../../packages/sdk/src/types/usage.ts#L90-L108) - `UsageTotal`"
  - "[code://packages/sdk/src/usage.ts#L22-L30](../../../../packages/sdk/src/usage.ts#L22-L30) - `Measured` and `none`"
  - "[code://packages/sdk/src/usage.ts#L115-L135](../../../../packages/sdk/src/usage.ts#L115-L135) - `measured`"
  - "[code://packages/sdk/src/usage.ts#L255-L273](../../../../packages/sdk/src/usage.ts#L255-L273) - the range total"
---

## Objective

A `UsageTotal` has `input`, `output` and `cache` beside `tokens`, and `tokens` is their sum.

## Files

- `UPDATE: packages/sdk/src/types/usage.ts:90-108` - `input?`, `output?` and `cache?` on `UsageTotal`, each with a one-line comment.
- `UPDATE: packages/sdk/src/usage.ts` - `Measured`, `none`, `measured`, `charge` and the range total carry the three counts.
- `UPDATE: packages/sdk/test/usage.test.ts` - the cases below, and the `toEqual` totals that gain fields.

## Steps

1. Write the tests.
2. Add the fields to the type and to `Measured`.
3. In `measured`, set `input` from `model.input`, `output` from `model.output`, and `cache` from both cache counts.
4. Add them in `charge` and in the range total; leave a zero out, as the other measures do.
5. Run `node tools/schema.mjs`.

## Validation

- `usage.test.ts`: one call with `input: 100, output: 20, cache: { read: 10, write: 2 }` gives `input: 100, output: 20, cache: 12, tokens: 132`.
- The same file: a call with no cache gives no `cache` key.
- The same file: computer time gives none of the three.
- `pnpm build`, `pnpm typecheck`, `pnpm boundary` and `npx vitest run` pass from the root.

## Resume
