---
title: Each person's key is counted
status: todo
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/usage/charge.ts#L409-L418](../../../../packages/sdk/src/usage/charge.ts#L409-L418) - `countCall`"
  - "[code://packages/sdk/src/usage/usage.ts#L43-L48](../../../../packages/sdk/src/usage/usage.ts#L43-L48) - `meterKey`"
---

## Objective

The meter adds to an `each` key and reads it back, so a minute limit for each person refuses the call past its amount.

## Files

- `UPDATE: packages/sdk/src/usage/usage.ts:43-48` - `measureOf(key)` reads the measure segment, and `meterKey` uses it.
- `UPDATE: packages/sdk/src/usage/charge.ts:409-418` - `countCall` counts a key whose `measureOf` is in `COUNTED_AT_CALL`.
- `UPDATE: packages/sdk/test/charge.test.ts` - a case for a minute limit of `calls` with `pool: each` and two users.

## Steps

1. Write `measureOf`: cut the key at `/user:` when it has one, then take the last segment.
2. Make `meterKey` return the `METERED` entry equal to `measureOf(pool)`.
3. Make `countCall` skip a key whose `measureOf` is not in `COUNTED_AT_CALL`.
4. Add a case with a limit of 2 calls a minute for each person.
5. In the case, refuse the third call of user A, and allow the first call of user B.

## Validation

- The new case fails without the change and passes with it.
- `pnpm --filter @ahpd/sdk test` passes, run alone.

## Resume
