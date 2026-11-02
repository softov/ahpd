---
title: A queued message taken up while idle is held to its turn - implemented
date: 2026-11-02
refs:
  - git://594c2fd5
  - "[code://packages/sdk/test/ahp-test-cases.test.ts](../../../../packages/sdk/test/ahp-test-cases.test.ts)"
---

A queued message the host takes up while idle holds the host to the turn the protocol says.
The four cases exempt the host's activity alone.

## What was built

- [`code://packages/sdk/test/ahp-test-cases.test.ts`](../../../../packages/sdk/test/ahp-test-cases.test.ts) - the driver keeps what the watching client was told.
- The goal walks the accepted actions through the reducer.
- After a queued message that finds the chat idle, the goal adds its removal and the turn naming it in `queuedMessageId`.
- That turn's id and start are read off the host's turn naming the message.
- 045, 046, 047 and 052 exempt `activity` under THINKING, and `CONSUMED` is gone; its rule is cited at the walk.

## Verified

- The whole file passes on the host as it stands, 647 tests.
- A probe made Claude's queued turn carry another message than the one queued.
- Against that host the new cases fail 045, 046, 047 and 052, and main's cases pass all 647.

## Departures from the plan

- none.

## Left for later

- none.
