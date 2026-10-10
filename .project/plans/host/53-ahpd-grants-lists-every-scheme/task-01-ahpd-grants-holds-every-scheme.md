---
title: ahpd.grants holds every scheme
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/root.ts#L215-L234](../../../../packages/sdk/src/host/root.ts#L215-L234) - `advertisedGrants`, which gains the schemes"
  - "[code://packages/sdk/src/users.ts#L76](../../../../packages/sdk/src/users.ts#L76) - `RESOURCE`, the groups a scheme takes"
---

## Objective

`advertisedGrants()` returns the eight built-in subjects and one entry per registered resource scheme the table does not hold, each shaped like a built-in entry.

## Files

- `UPDATE: packages/sdk/src/host/root.ts:173-234` - `advertisedGrants` merges in the schemes; the operations come from the same lookup `advertisedSchemes` uses, so the two keys cannot drift.
- `UPDATE: packages/sdk/test/users-host.test.ts:338-360` - the handshake test asserts the people schemes and their groups.
- `UPDATE: packages/sdk/test/plugin-host.test.ts` - a plugin scheme is listed with its operations.

## Steps

1. Pull the operation lookup out of `advertisedSchemes` into one helper both functions call.
2. In `advertisedGrants`, for each `options.resourceProviders` scheme not in `OPERATIONS`, add `{ title, description, operations, groups }`: `title` and `description` from `describe()` when it says them, else the scheme name; `groups.read` and `groups.write` are `RESOURCE`'s, kept to `operations`.
3. Leave `advertisedSchemes` and `ahpd.resourceProviders` as they are.

## Validation

- `users-host.test.ts`: with a users directory, `ahpd.grants` has `user`, `team`, `project`, `role`, `membership` and `policy`, each with `get` in `operations` and in `groups.read`, and `put` in `groups.write`.
- `plugin-host.test.ts`: a fixture scheme is listed with exactly the operations its provider implements.
- Without a provider, `ahpd.grants` has the eight built-in keys only.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test`.

## Resume

