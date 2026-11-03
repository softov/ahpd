---
title: A negotiation case holds whether the connection closes - implemented
date: 2026-11-02
refs:
  - git://47f20a35
  - "[code://packages/sdk/test/ahp-test-cases.test.ts](../../../../packages/sdk/test/ahp-test-cases.test.ts)"
---

An invalid version offer owes `-32602` and a connection still open, as the protocol's interop host answers one.

## What was built

- [`code://packages/sdk/test/ahp-test-cases.test.ts`](../../../../packages/sdk/test/ahp-test-cases.test.ts) - an invalid row owes `{ code: -32602, closed: false }`.
- The comment over the negotiation cases says the connection stays open after a malformed offer.

## Verified

- The 22 negotiation rows pass on the host as it stands, and the whole file passes, 647 tests.
- A probe made the host close the connection before it threw `-32602`.
- Against that host the new rows 12 to 22 fail, 11 tests, and main's rows pass all 22.

## Departures from the plan

- none.

## Left for later

- none.
