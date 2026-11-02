---
title: A refusal goes to every subscriber
status: todo
depends: []
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `refuse` and `emit`"
---

## Objective

A refusal takes the next `serverSeq`, is held for replay, and goes to every client of its channel and to its sender.

## Files

- `UPDATE: packages/sdk/src/host.ts` - `emit` takes a refusal's reason and reduces nothing for it; `refuse` sends through it.
- `UPDATE: docs/sdk/AHP.md` - the two passages on a refusal.
- `UPDATE: packages/sdk/test/host-snapshots.test.ts` - a second subscriber hears the refusal, and a reconnect replays it.

## Steps

1. Add an optional `rejectionReason` to `emit`.
2. Skip the reducers and the observers in `emit` for a refusal.
3. Flush the held deltas, then send the refusal through `emit`.
4. Send it to the sender as well when the sender watches no such channel.

## Validation

- `pnpm exec vitest run packages/sdk/test/host-snapshots.test.ts` - passes; the changed case fails on 839080c4.
