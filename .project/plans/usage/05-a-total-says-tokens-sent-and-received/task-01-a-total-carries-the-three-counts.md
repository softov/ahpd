---
title: A total carries the three counts
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/usage.ts#L90-L111](../../../../packages/sdk/src/types/usage.ts#L90-L111) - `UsageTotal`"
  - "[code://packages/sdk/src/usage.ts#L22-L33](../../../../packages/sdk/src/usage.ts#L22-L33) - `Measured` and `none`"
  - "[code://packages/sdk/src/usage.ts#L118-L144](../../../../packages/sdk/src/usage.ts#L118-L144) - `measured`"
  - "[code://packages/sdk/src/usage.ts#L261-L293](../../../../packages/sdk/src/usage.ts#L261-L293) - the range total"
---

## Objective

A `UsageTotal` has `input`, `output` and `cache` beside `tokens`, and `tokens` is their sum.

## Files

- `UPDATE: packages/sdk/src/types/usage.ts:90-111` - `input?`, `output?` and `cache?` on `UsageTotal`, each with a one-line comment.
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

The cases the validation names are in `packages/sdk/test/usage.test.ts`. The test of a model call now reads `input: 100, output: 20, cache: 12, tokens: 132`. A new case proves a call with no cache carries no `cache` key. The computer-time case proves a machine is charged none of the three counts. The `toEqual` totals further down gained the counts they now carry.

`UsageTotal` carries `input`, `output` and `cache` beside `tokens`. Its doc comment says `tokens` is the three added together. `Measured`, `none`, `measured`, `charge` and the range total carry the three counts. A count of zero is left out, as every other measure is.

Nothing is left. The full suite is 249 files and 4326 tests. `pnpm build`, `pnpm typecheck` and `pnpm boundary` are clean, and so is `node tools/schema.mjs`.

Found: `ahpd usage <pool>` renders every key of a total. The three counts reach the terminal with no change to the command.
