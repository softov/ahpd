---
title: ahpd speaks AHP 1.0.0, and keeps 0.9.0 - implemented
date: 2026-10-09
refs:
  - "[code://packages/sdk/src/host/catalogue.ts](../../../../packages/sdk/src/host/catalogue.ts)"
---

ahpd speaks AHP 1.0.0 and still serves a 0.9.0 client.
An automation disables itself as its definition says, and a session's row lists its chats with their own read and archived bits.

## What was built

- [p1](../44-ahpd-speaks-ahp-1-0-0-p1-ahpd-speaks-1-0-0-and-0-9-0/implemented.md) - the 1.0.0 handshake beside 0.9.0.
- [p2](../44-ahpd-speaks-ahp-1-0-0-p2-an-automation-disables-itself/implemented.md) - `disableConditions` and the refusals.
- [p3](../44-ahpd-speaks-ahp-1-0-0-p3-a-sessions-row-lists-its-chats/implemented.md) - the row's chats and a chat's own bits.

## Verified

- Each child's implemented.md lists its tests and gate run.

## Departures from the plan

- None beyond those each child lists.

## Left for later

- ahpapp and ahpc moving to the 1.0.0 package, which is their own work.
