---
title: Steering test cases exempt whole keys from the check
status: open
date: 2026-11-03
severity: minor
blocks: []
refs:
  - "[code://packages/sdk/test/ahp-test-cases.test.ts#L352-L358](../../packages/sdk/test/ahp-test-cases.test.ts#L352-L358) - `DIVERGES` for cases 039 to 041 and 052"
  - git://594c2fd5 - cases 045 to 047 now exempt only `activity`
  - git://77ba53f8 - main when the problem was read
---

## Symptom

Read from the code in the review of 2026-11-03, and not reproduced.
Cases 039 to 041 and 052 exempt `activeTurn`, `steeringMessage`, and in 052 `queuedMessages`, as whole keys.
A wrong value under those keys passes the test.

## Cause

The cases share `BROKEN.idleSteering`, which lists the keys that diverge.
The divergence is in part of each key, and the exemption takes the whole key.

## Impact

The conformance suite does not check steering and queue state in these cases.

## Workaround

None.

## Fix

- Narrow each exemption to the field that differs, as 594c2fd5 did for 045 to 047.
