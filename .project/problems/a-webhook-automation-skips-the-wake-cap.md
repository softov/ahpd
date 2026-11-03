---
title: A connector that names an automation skips the wake cap and the overlap mode
status: open
date: 2026-11-03
severity: major
blocks: []
refs:
  - "[code://packages/sdk/src/host/automations.ts#L1321-L1354](../../packages/sdk/src/host/automations.ts#L1321-L1354) - `runOne` calls `fly` directly"
  - "[code://packages/sdk/src/host/automations.ts#L578-L600](../../packages/sdk/src/host/automations.ts#L578-L600) - `request` applies `counted` and the overlap mode"
  - "[code://packages/sdk/src/host/automations.ts#L1231-L1238](../../packages/sdk/src/host/automations.ts#L1231-L1238) - `counted` drops a wake past `WAKES_AN_HOUR`"
  - git://97e65df5 - plugin/54 added `runOne` for connectors
  - git://77ba53f8 - main when the problem was read
---

## Symptom

Read from the code in the review of 2026-11-03, and not reproduced.
A webhook connector names an automation whose overlap is `queue`.
The sender posts 30 proved calls in a minute.
30 runs start in parallel, and none is dropped or queued.

## Cause

An event wake goes through `request`, which counts wakes and applies `skip`, `queue` or `steer`.
`runOne` builds the facts and calls `fly`, which starts a run at once.

## Impact

Anyone who can sign a webhook call can start any number of runs at once.
Each run can cost model calls and machine time.

## Workaround

None.

## Fix

- Make `runOne` call `request` with `byEvent: true`, so a connector wake is counted and keeps the overlap mode.
