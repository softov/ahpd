---
title: A minute limit on tokens, usd or hours reads nothing when a plugin's usage store is used
status: open
date: 2026-11-03
severity: minor
blocks: []
refs:
  - "[code://packages/server/src/commands/run.ts#L1693](../../packages/server/src/commands/run.ts#L1693) - a plugin's usage store replaces the daemon's"
  - "[code://packages/server/src/commands/run.ts#L463](../../packages/server/src/commands/run.ts#L463) - the one meter is wired to the daemon's store"
  - git://67889a93 - policy/20261029-2013 added the minute meter
  - git://77ba53f8 - main when the problem was read
---

## Symptom

Read from the code in the review of 2026-11-03, and not reproduced.
A plugin folds in its own usage store.
A minute limit on `tokens`, `usd` or `hours` then allows every call.

## Cause

The meter is fed from the records the daemon's store writes.
When `folded.usage` replaces the store, records do not reach the meter, and its sums stay 0.

## Impact

A rate limit on cost or tokens does nothing on a host that keeps usage in a plugin.
A limit on `calls` or `turns` still works, because those are counted when a call is allowed.

## Workaround

None.

## Fix

- Feed the meter from the record path that every store shares.
- Or wrap the folded store so that each record it writes also reaches the meter.
