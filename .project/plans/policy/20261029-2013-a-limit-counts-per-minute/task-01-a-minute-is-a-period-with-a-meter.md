---
title: A minute is a period with a meter
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/policies.ts](../../../../packages/sdk/src/types/policies.ts) - `Period` gets `minute`"
  - "[code://packages/sdk/src/access/policies.ts](../../../../packages/sdk/src/access/policies.ts) - `PERIODS` gets `minute`"
  - "[code://packages/sdk/src/usage/periods.ts](../../../../packages/sdk/src/usage/periods.ts) - `periodOf` answers a minute"
  - "[code://packages/sdk/src/usage/usage.ts](../../../../packages/sdk/src/usage/usage.ts) - `fileUsage` feeds the meter"
---

## Objective

`minute` is a period a limit can name, and one in-memory meter answers what each pool key used in the current minute.
The usage store adds the measures of each record it keeps to the meter.

## Files

- `UPDATE: packages/sdk/src/types/policies.ts:65-66` - adds `minute` to `Period`.
- `UPDATE: packages/sdk/src/access/policies.ts:44-52` - adds `minute` to `PERIODS`.
- `UPDATE: packages/sdk/src/usage/periods.ts:90-112` - `periodOf` answers the start of the current minute and the start of the next one for `minute`.
- `CREATE: packages/sdk/src/usage/minute.ts` - `createMinuteMeter`: `add(key, amount, at)` and `sum(key, at)`, which keep the current and the last minute of each key.
- `UPDATE: packages/sdk/src/index.ts` - exports `createMinuteMeter` and its type.
- `UPDATE: packages/sdk/src/usage/usage.ts:155-370` - `fileUsage` takes an optional `meter`, and `record` adds `tokens`, `usd` and `hours` for each of the record's pools.
- `CREATE: packages/sdk/test/minute-meter.test.ts` - the meter.
- `UPDATE: packages/sdk/test/usage.test.ts` - the store feeds the meter.
- `UPDATE: packages/sdk/test/policy-checks.test.ts` - `minute` is accepted.

## Steps

1. Add `minute` to `Period` and to `PERIODS`.
2. Make `periodOf` answer a `minute` from the UTC minute of `now`, with `resets` one minute later.
3. Write `createMinuteMeter`: a map from key to two buckets, the current minute and the one before.
4. Make `add` move a key's buckets on when the minute of `at` is newer.
5. Make `add` drop buckets older than one minute.
6. Make `sum(key, at)` answer the bucket of the minute of `at`, or 0.
7. Add the `meter` option to `fileUsage`.
8. In `record`, read the measure from the end of each pool key, such as `.../tokens`.
9. Add the record's amount in that measure to the meter for `tokens`, `usd` and `hours` keys only.
10. Write the tests.

## Validation

- `minute-meter.test.ts`: two adds in one minute sum; an add in the next minute starts at 0; a key unused for two minutes is dropped.
- `usage.test.ts`: a record charged to `policy:a/tokens` and `policy:a/calls` adds its tokens to the first and nothing to the second.
- `policy-checks.test.ts`: a limit with `period: minute` is accepted.
- Run `pnpm typecheck` and `pnpm test`.

## Resume

- **Done so far:** `Period` and `PERIODS` take `minute`, and `PERIODS` lists it first. `periodOf` answers a minute from the UTC minute of `now`, with `resets` a minute later. `createMinuteMeter` in `packages/sdk/src/usage/minute.ts` keeps two buckets per key, `add` turns them and drops anything older than the minute before, and `sum` answers the bucket of the minute asked or 0. `fileUsage` takes an optional `meter`, and `record` adds the record's amount to each pool key that ends in `/usd`, `/tokens` or `/hours`.
- **Next action:** [task-02-a-minute-limit-is-checked-and-counted.md](task-02-a-minute-limit-is-checked-and-counted.md).
- **Files:** `packages/sdk/src/types/policies.ts`, `packages/sdk/src/access/policies.ts`, `packages/sdk/src/usage/periods.ts`, `packages/sdk/src/usage/minute.ts`, `packages/sdk/src/usage/usage.ts`, `packages/sdk/src/index.ts`, `packages/sdk/test/minute-meter.test.ts`, `packages/sdk/test/usage.test.ts`, `packages/sdk/test/policy-checks.test.ts`, this task file and the plan.
- **Open questions:** none.
- **Departures:** the meter is fed in `record` and not in `charge`, so the folder read at construction does not count the last minutes of a previous run.
- **Watch out for:** `periodOf` cuts a minute in UTC and every other window in `usage.timezone`. `minuteOf` and `MINUTE_MS` live in `periods.ts`, and the meter imports `minuteOf` from there.

