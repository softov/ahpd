---
title: "A session reads as running while any of its chats runs, a worker chat included - implemented"
date: 2026-09-28
refs:
  - git://373253e
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `drivingOf`, `statusOf`, `activityOf`"
---

A session reads as running while any of its chats runs, a worker chat included, and as waiting when any of them waits on a person.

## What was built

- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `drivingOf` picks the chat whose status outranks the lead's (`InputNeeded`, then `Error`, then `InProgress`); `statusOf` and `activityOf` follow it, and a worker's move updates the summary.

## Verified

- `subagent-chat.test.ts`: a worker running after the lead turn, a worker asking while the lead runs, and a second chat running while the lead is idle; all failed first.
- `pnpm typecheck`, `pnpm boundary` clean; full `pnpm test` 1571 of 1571.

## Departures from the plan

- The cases are in `subagent-chat.test.ts`, whose fakes run a worker and a second chat without the Claude SDK mock.

## Left for later

- By hand: the session list in ahpapp.
