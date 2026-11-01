---
title: A channel opens with the state it is handed
status: todo
depends: []
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/types/host.ts](../../../../packages/sdk/src/types/host.ts) - `HostOptions.opening`, beside `now` and `timer`"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `openState`"
---

## Objective

A host handed `opening` opens a root, session or chat channel with the state it answers for that channel, and with its own seed otherwise.

## Files

- `UPDATE: packages/sdk/src/types/host.ts` - `opening?(channel, kind)`, documented as the seam a test supplies.
- `UPDATE: packages/sdk/src/host.ts` - `openState` reads `opening` before the seed it was given.

## Steps

1. Declare `opening` on `HostOptions` beside `now` and `timer`.
2. Read it in `openState`, and open the channel with its answer when it gives one.

## Validation

- `pnpm run typecheck` exits 0.
- `ahp-test-cases.test.ts` opens each case's channel with its `initial`, which the start check reads.

## Resume

Not started.
