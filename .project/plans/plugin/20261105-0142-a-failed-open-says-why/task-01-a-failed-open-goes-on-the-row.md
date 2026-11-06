---
title: A failed open goes on the row
status: done
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/agents/channel.ts#L449-L456](../../../../packages/sdk/src/agents/channel.ts#L449-L456) - the open at start"
---

## Objective

A record that does not open at start has the error on its row's `health`, until it opens.

## Files

- `UPDATE: packages/sdk/src/agents/channel.ts` - a failed open sets `health`, and a later open removes it.
- `UPDATE: packages/sdk/src/connectors/channel.ts` - a failed `openOne` sets `health.check`, and a later open removes it.
- `UPDATE: packages/sdk/test/agents-channel.test.ts` - a host record with a missing variable, then the variable set.
- `UPDATE: packages/sdk/test/connectors-channel.test.ts` - the same case for a connector.

## Steps

1. In the agents channel, set the row's `health` to `failed` with the error when an open fails.
2. Remove that health on a later open, a check or a removal.
3. In the connectors channel, set `health.check` to `failed` with the error when `openOne` fails.
4. Remove that check on a later open, a check or a close.
5. Add a case to each channel test.

## Validation

- The new cases pass.
- `pnpm --filter @ahpd/sdk test` passes, run alone.

## Resume

- **Done so far:** every step.
- **Found:** the put path of a connector calls `openOne` too, so a failed put also leaves the reason on the row.
