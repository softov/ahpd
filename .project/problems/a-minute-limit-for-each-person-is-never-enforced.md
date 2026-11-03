---
title: A minute limit with pool each is never enforced
status: open
date: 2026-11-03
severity: major
blocks: []
refs:
  - "[code://packages/sdk/src/usage/charge.ts#L137-L140](../../packages/sdk/src/usage/charge.ts#L137-L140) - `keyOf` ends the key of an `each` row in `/user:<id>`"
  - "[code://packages/sdk/src/usage/charge.ts#L408-L419](../../packages/sdk/src/usage/charge.ts#L408-L419) - `countCall` counts only a key that ends in `/calls` or `/turns`"
  - "[code://packages/sdk/src/usage/usage.ts#L43-L48](../../packages/sdk/src/usage/usage.ts#L43-L48) - `meterKey` reads only the last segment of the key"
  - "[code://packages/sdk/src/access/policies.ts#L116-L126](../../packages/sdk/src/access/policies.ts#L116-L126) - `limitOf` accepts a minute period with any pool"
  - git://67889a93 - policy/20261029-2013 added the minute period
  - git://77ba53f8 - main when the problem was read
---

## Symptom

Read from the code in the review of 2026-11-03, and not reproduced.
A policy row has a limit with `period: minute` and `pool: each`.
Calls go past the amount in one minute, and the limit refuses none of them.

## Cause

The key of an `each` row is `<base>/<measure>/user:<id>`.
`countCall` matches only a key that ends in the measure, so it never adds to that key.
`meterKey` takes the last segment, `user:<id>`, which is not a metered measure.
The meter sum for the key stays 0.

## Impact

An operator who sets a per-person rate limit gets no limit, and is not told.
No test covers the pair.

## Workaround

Use `pool: all` for a minute limit.

## Fix

- Refuse `period: minute` with `pool: each` in `limitOf`.
- Or match the measure segment, not the end of the key, in `countCall` and `meterKey`, and add a test for the pair.
