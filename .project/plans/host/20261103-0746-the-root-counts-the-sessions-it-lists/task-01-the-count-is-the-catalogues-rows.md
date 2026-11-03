---
title: The count is the catalogue's rows
status: done
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/catalogue.ts#L493-L517](../../../../packages/sdk/src/host/catalogue.ts#L493-L517) - `activeCount`"
  - "[code://packages/sdk/src/host/history.ts#L203-L213](../../../../packages/sdk/src/host/history.ts#L203-L213) - a listing landing"
---

## Objective

`activeSessions` counts every session the catalogue lists, by id: running, asleep or found by a listing.
A turn's start and end move nothing, and a listing that finds or loses rows moves the count.

## Files

- `UPDATE: packages/sdk/src/host/catalogue.ts:493-517` - the count is the ids of the running, sleeping and listed sessions.
- `UPDATE: packages/sdk/src/host/catalogue.ts:1460-1500` - a chat's action no longer reads the count.
- `UPDATE: packages/sdk/src/host/history.ts:203-213` - a listing landing reads the count, and `listed` hands the rows.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:1499-1503` - a chat's close no longer reads the count.
- `UPDATE: packages/sdk/src/host/root.ts:648` - the seed's comment.
- `UPDATE: packages/sdk/test/host-catalogue.test.ts:47-74` - every listed session counts until one is disposed.
- `UPDATE: packages/sdk/test/presence.test.ts` - a session made and disposed moves the count, and a turn does not.
- `UPDATE: packages/sdk/test/session-sleep.test.ts` - a sleeping session counts.
- `UPDATE: docs/sdk/AHP.md` - the `root/activeSessionsChanged` row.
- `UPDATE: docs/sdk/HOST.md` - the `activeSessions` row.
- `UPDATE: docs/sdk/SESSIONS.md` - what a sleep does to the count.

## Steps

1. Count the ids of the running, sleeping and listed sessions together.
2. Count a session once `root/sessionAdded` has said it.
3. Read the count again when a listing lands.
4. Stop reading it after a chat's action or close.
5. Change the cases that counted turns.
6. Describe the count in the docs.

## Validation

- `packages/sdk/test/host-catalogue.test.ts`: the changed case fails on `cde4dd6c` and passes after.
- The catalogue, presence, sleep and wakeup test files pass.
- `pnpm run typecheck` is clean.

## Resume

Built 2026-11-03.

- On `cde4dd6c`'s sources the catalogue case fails: the listed sessions count 0.
- The wakeup case reads the stored session as counted, and none awake.
