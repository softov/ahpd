---
title: Action dispatch is split by family - implemented
date: 2026-10-04
refs:
  - git://ca6adcb
  - "[code://packages/sdk/src/host/actions.ts](../../../../packages/sdk/src/host/actions.ts)"
---

A dispatched action is gated and applied from its own file, and chat actions from theirs.

## What was built

- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) - `createActions`, the dispatch gate and `applyDispatch`.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - `chatAction`, the chat family.

## Verified

- Checked with p9 as one move; see [p9's implemented.md](../48-host-is-split-by-area-p9-the-method-table/implemented.md).
- `host.ts` is 1,141 lines after p10, from 5,077 before p9.

## Departures from the plan

- None.
