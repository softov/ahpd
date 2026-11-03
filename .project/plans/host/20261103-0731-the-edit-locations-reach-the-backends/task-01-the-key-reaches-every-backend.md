---
title: The key reaches every backend
status: todo
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/lifecycle.ts#L1024-L1026](../../../../packages/sdk/src/host/lifecycle.ts#L1024-L1026) - `backendsOwn`"
  - "[code://packages/sdk/src/host/chatactions.ts#L1116-L1153](../../../../packages/sdk/src/host/chatactions.ts#L1116-L1153) - `taking`"
---

## Objective

A backend is started with `sensitiveEditLocations` when its session holds the key.
A change of the key on a running session goes to every chat's `setConfig`, and the host's answer stands whatever the backend says.

## Files

- `UPDATE: packages/sdk/src/host/lifecycle.ts:1024-1026` - `backendsOwn` keeps out this host's own keys alone.
- `UPDATE: packages/sdk/src/host/chatactions.ts:1116-1153` - a taken key goes to every chat's backend once the action is taken.
- `UPDATE: packages/sdk/src/host/common.ts:55-86` - `HOSTS_TAKEN` says the key reaches every backend.
- `UPDATE: packages/sdk/test/autoapproval.test.ts:259-290` - the start's settings and the change handed on.
- `UPDATE: docs/sdk/AHP.md` - the `session/configChanged` row.

## Steps

1. Keep only this host's own keys out of `backendsOwn`.
2. Hand each taken key to every chat's `setConfig` once `taking` has taken the action.
3. Say in `HOSTS_TAKEN`'s comment that every backend gets the key.
4. Add the case of a backend started with the key and handed its change.
5. Describe the key's road in the `session/configChanged` row.

## Validation

- `packages/sdk/test/autoapproval.test.ts`: the new case fails on `cde4dd6c` and passes after.
- The autoapproval test file passes.
- `pnpm run typecheck` is clean.

## Resume

Not started.
