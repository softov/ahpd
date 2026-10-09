---
title: A total is read for any range
status: done
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/usage.ts#L405-L445](../../../../packages/sdk/src/usage.ts#L405-L445) - `LEAVES` and the URI reader"
  - "[code://packages/sdk/src/usage.ts#L285-L323](../../../../packages/sdk/src/usage.ts#L285-L323) - `total`, which takes any range"
---

## Objective

`usage://<pool>/range?from=&until=` answers the pool's total between two days.

## Files

- `UPDATE: packages/sdk/src/usage.ts` - add `range` to `LEAVES`, and answer it from `store.total`.
- `UPDATE: packages/sdk/test/usage-scheme.test.ts` - the range cases.
- `UPDATE: docs/USAGE.md` - the `range` leaf.

## Steps

1. Add `range` to `LEAVES`.
2. Answer `range` with `store.total(pool, from, until)`, with the defaults the `records` leaf uses.
3. Refuse a bad `from` or `until` with the error that the `records` leaf gives.
4. Write a test: a range of two days sums the records of those two days only.
5. Write a test: `records` and `range` with the same `from` and `until` agree.
6. Describe `range` in `docs/USAGE.md`.

## Validation

- The ahpd gates pass.

## Resume

- `packages/sdk/src/usage.ts`: `range` is in `LEAVES`, and answers `store.total` over the asked range.
- `rangeOf` holds the `records` defaults, the first day of the month in the zone and now, and `records`, `range` and `groups` read their bounds through it.
- A bound that is not a date is refused with `-32602`. The `records` leaf had no such error before, so this adds it to `records` as well.
- `packages/sdk/test/usage-scheme.test.ts`: a test of a two-day range, of `records` and `range` agreeing, of the default range, and of the refusal on both leaves.
- `docs/USAGE.md`: the `range` row and a section on the range.
