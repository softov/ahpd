---
title: A case starts from its initial - implemented
date: 2026-11-01
refs:
  - git://7a2097e6
  - "[code://packages/sdk/src/types/host.ts](../../../../packages/sdk/src/types/host.ts)"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts)"
  - "[code://packages/sdk/test/ahp-test-cases.test.ts](../../../../packages/sdk/test/ahp-test-cases.test.ts)"
---

Each of the protocol's root, session and chat cases now runs through the host from the case's own `initial`.
The oracle holds the result to the case's `expected`, and names each key the host says otherwise, at the start and after.

## What was built

- [`code://packages/sdk/src/types/host.ts`](../../../../packages/sdk/src/types/host.ts) - `HostOptions.opening`, the state a channel opens with when a test hands one.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `openState` reads `opening` before the seed it was given.
- [`code://packages/sdk/test/ahp-test-cases.test.ts`](../../../../packages/sdk/test/ahp-test-cases.test.ts) - `driven` seeds the case's channel, `PEER_CHATS` for 272 and 273, the `start` check, and `cameUp` for a created session.
- The same file - the entries the seeded cases show, each with its correction or its sentence.

## Verified

- Seeded and before its entries, the file failed 110 of the 248 host cases.
- With them, it passes 647 of 647, and the served check finds no key on any case.
- The full unit run at two workers passes 7351 of 7352, and the process run 695 of 695.

## Departures from the plan

- The goal compares with the reducer over the watching client's start when the start differs from `initial`.
- A session the driver creates says its customizations and `session/ready` after its state opens, so every session case starts there.
- Case 072's read-coupling entry and case 073's allowance go: their seeded sessions hold no chats, so the host's chat moves reach no row.

## Left for later

- The suite's dispatches with no `clientSeq`, which stay in the oracle plan's [deferred.md](../20261101-0207-the-protocol-cases-are-the-oracle/deferred.md).
