---
title: A total is read for any range
status: todo
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
