---
title: The edit locations reach the backends - implemented
date: 2026-11-03
refs:
  - git://8abddb95 - the change
  - "[code://packages/sdk/src/host/lifecycle.ts](../../../../packages/sdk/src/host/lifecycle.ts)"
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts)"
  - "[code://packages/sdk/src/host/spawn.ts](../../../../packages/sdk/src/host/spawn.ts)"
---

Every backend is handed `sensitiveEditLocations`: in its start's settings, and through `setConfig` as the key moves.
The host takes the key whatever the backend answers.
The command check reads the locations whole, and a value with an entry that does not fit is none.

## What was built

- [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts) - `backendsOwn` keeps out this host's own keys alone.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - `taking` hands a taken key to every chat.
- [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts) - the locations read whole.
- [`code://packages/sdk/src/host/common.ts`](../../../../packages/sdk/src/host/common.ts) - `HOSTS_TAKEN`'s comment.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - the `session/configChanged` row.

## Verified

- On `cde4dd6c`'s source both new cases fail: no start has the key, and the good entry of a malformed value asks.
- With the change the autoapproval file passes 11 of 11.
- The example file passes 7 of 7, the command approver 46 of 46, fixed keys 19 of 19, and the nested proxy 66 of 66.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- None.
