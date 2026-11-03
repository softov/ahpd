---
title: A session's row takes a busy chat's status - implemented
date: 2026-11-02
refs:
  - git://ba28a312 - the change
  - "[code://packages/sdk/src/host/catalogue.ts](../../../../packages/sdk/src/host/catalogue.ts)"
---

A session's row reads busy while any of its chats is busy, as VS Code's host promotes it.
A chat that needs input makes the row need input, and else a chat that runs makes it run.
Otherwise the row reads its default chat, and a failed chat says so on its own row.

## What was built

- [`code://packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts) - `drivingOf` aggregates by `_aggregateChatSummaries`, and the row's activity follows the deciding chat.
- [`code://packages/sdk/test/subagent-chat.test.ts`](../../../../packages/sdk/test/subagent-chat.test.ts) - a row with a busy worker or a busy second chat reads running.
- [`code://packages/sdk/test/host-catalogue.test.ts`](../../../../packages/sdk/test/host-catalogue.test.ts) - a failed second chat leaves the row at the default chat's bits.
- [`code://docs/sdk/SESSIONS.md`](../../../../docs/sdk/SESSIONS.md) - how a session of several chats reads its status.

## Verified

- On `6e6d1ca8`'s `catalogue.ts` the three cases fail: two read 1 where 8 is owed, and the failed chat's row reads 2 where 1 is owed.
- With `ba28a312` both files pass, 97 of 97.
- The 23 unit files that read a session row's status pass with the change, 1343 tests, all the protocol's cases among them.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- None.

## Left for later

- None.
