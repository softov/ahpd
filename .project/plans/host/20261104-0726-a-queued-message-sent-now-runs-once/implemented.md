---
title: A queued message sent now runs once - implemented
date: 2026-11-04
refs:
  - git://bc9d0659
  - "[code://packages/sdk/src/host/chatactions.ts#L1485-L1500](../../../../packages/sdk/src/host/chatactions.ts#L1485-L1500)"
  - "[code://packages/sdk/test/host-steering.test.ts](../../../../packages/sdk/test/host-steering.test.ts)"
---

A client can send a queued message again under its id as steering.
The running turn takes it once, and no turn of its own runs for it afterwards.

## What was built

- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - after a `steer` that took the message, the host calls `session.unqueue(id)` when that id was queued.
- [`code://packages/sdk/test/host-steering.test.ts`](../../../../packages/sdk/test/host-steering.test.ts) - the queue loses a steered message once; a fresh id takes nothing out.

## Verified

- The two cases in `host-steering.test.ts` pass, and the first fails without the change.
- CI passed on PR #218.
- Softov checked ahpw's "Send now" on a live Claude session on 2026-11-04.
- The message left the queue, showed as Steering, reached the running turn, and did not run again.

## Departures from the plan

- none.

## Left for later

- none.
