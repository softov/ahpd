---
title: People and policy are served by one record-store provider, and the value readers are one sdk module - implemented
date: 2026-10-10
refs:
  - git://bd1ce56
  - "[code://packages/sdk/src/values.ts](../../../../packages/sdk/src/values.ts)"
  - "[code://packages/sdk/src/records.ts](../../../../packages/sdk/src/records.ts)"
---

The value readers that 19 files wrote again are one sdk module, and people and policy are served by one record-store provider.
Usage, computer and the four agent packages take the shared parts instead of their own copies.

## What was built

- [`code://packages/sdk/src/values.ts`](../../../../packages/sdk/src/values.ts) - `isRecord`, `bag`, `str`, `strings`, `reason` and the owner reader, exported from the sdk.
- [`code://packages/sdk/src/records.ts`](../../../../packages/sdk/src/records.ts) - the `Records` port and the provider over it, which people and policy both use.
- Usage, the host's resource read and computer use the shared split, file and body helpers.
- The five plugin packages pin the sdk peer range that exports the helpers, checked in `plugin-compat.test.ts`.
- agent-acp, agent-claude and agent-cofold take `bag`, `str` and `reason` from the sdk.

## Verified

- Each task file lists its tests; tasks 01 to 06 merged in `bd1ce56`.
- The checklist's `rg` finds `bag`, `str` and `isRecord` only in `values.ts`.
- Full gates on task 07 applied to main.

## Departures from the plan

- The shared `bag` answers `{}` for an array, where 16 of the 19 copies kept the array. The plan named this, and no call site read an array through `bag`.

## Left for later

- `packages/bot/src/provider.ts` keeps its own `split`, `absent` and `moment`, because no task named bot.
- Inline error readers in files no task opened stay as they are.
