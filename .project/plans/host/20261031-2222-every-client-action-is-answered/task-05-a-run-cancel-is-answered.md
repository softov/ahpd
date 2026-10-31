---
title: A run cancel is answered
status: planned
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/actions.ts](../../../../packages/sdk/src/host/actions.ts) - `automationRun/cancelRequested`"
  - "[code://packages/sdk/src/host/automations.ts](../../../../packages/sdk/src/host/automations.ts) - `cancelRun`"
  - "[code://docs/sdk/AUTOMATIONS.md](../../../../docs/sdk/AUTOMATIONS.md) - the client actions table"
---

## Objective

A cancel the store takes is answered to its sender with its own action and origin; the run's lifecycle change follows to everyone; a cancel of a run unknown or over stays a refusal.

## Files

- `UPDATE: packages/sdk/src/host/actions.ts` - the cancel taken is answered to its sender.
- `UPDATE: packages/sdk/test/automations.test.ts` - a cancel is answered once, and the run settles `cancelled`.
- `UPDATE: docs/sdk/AUTOMATIONS.md`, `docs/sdk/AHP.md` - the `automationRun/cancelRequested` rows.

## Steps

1. Write the case and see it fail on `08b1d57a`: nothing carries the sender's origin.
2. Answer the cancel.

## Validation

- The case fails on `08b1d57a` and passes after.
