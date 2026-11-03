---
title: The root counts the sessions it lists - implemented
date: 2026-11-03
refs:
  - git://5825ad33 - the change
  - "[code://packages/sdk/src/host/catalogue.ts](../../../../packages/sdk/src/host/catalogue.ts)"
  - "[code://packages/sdk/src/host/history.ts](../../../../packages/sdk/src/host/history.ts)"
---

The root's `activeSessions` is the number of sessions not disposed: every row of the catalogue, by id.
A session running, one asleep and a transcript a listing found each count, from `root/sessionAdded` to `root/sessionRemoved`.
A turn's start and end move nothing, and a listing that finds or loses rows moves the count.

## What was built

- [`code://packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts) - `activeCount` over the running, sleeping and listed sessions.
- [`code://packages/sdk/src/host/history.ts`](../../../../packages/sdk/src/host/history.ts) - `listed`, and the count read again as a listing lands.
- [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts) - a chat's close reads no count.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md), [`code://docs/sdk/HOST.md`](../../../../docs/sdk/HOST.md) and [`code://docs/sdk/SESSIONS.md`](../../../../docs/sdk/SESSIONS.md) - what the number counts.

## Verified

- On `cde4dd6c`'s source the catalogue case fails: two listed transcripts and a running session count 0.
- With the change the catalogue file passes 73 of 73, presence 22 of 22, sleep 14 of 14, and wakeups 9 of 9.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- The wakeup case read 0 for a stored session a restarted host had not woken; it reads 1 now, the session not disposed.
