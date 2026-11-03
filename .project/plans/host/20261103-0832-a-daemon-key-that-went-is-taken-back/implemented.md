---
title: A daemon key that went is taken back - implemented
date: 2026-11-03
refs:
  - git://9ea92f1d - the change
  - "[code://packages/sdk/src/host/root.ts](../../../../packages/sdk/src/host/root.ts)"
---

A daemon key the file no longer holds is taken back by a `root/configChanged` that replaces the root's values with every value it still holds.
A key whose value moved still sends a merge of that key alone.

## What was built

- [`code://packages/sdk/src/host/root.ts`](../../../../packages/sdk/src/host/root.ts) - `daemonValuesMoved` sends the replacement.

## Verified

- On `cde4dd6c`'s source the new case fails: the key is said as a `null` in a merge.
- With the change the root config file passes 35 of 35.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- None.
