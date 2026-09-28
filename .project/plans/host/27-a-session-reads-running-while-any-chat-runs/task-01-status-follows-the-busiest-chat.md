---
title: The session's status and activity follow its busiest chat
status: implemented
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L1177-L1197](../../../../packages/sdk/src/host.ts#L1177-L1197) - `statusOf`"
  - "[code://packages/sdk/src/host.ts#L2987-L2998](../../../../packages/sdk/src/host.ts#L2987-L2998) - `sendSubagent`"
  - "[code://packages/sdk/test/subagent-chat.test.ts](../../../../packages/sdk/test/subagent-chat.test.ts) - the fake backend whose worker runs and asks"
---

## Objective

`statusOf` promotes `InputNeeded`, then `Error`, then `InProgress` from any held chat or worker chat over the lead chat's activity, the summary's `activity` follows the chat that won, and a worker's change that moves either re-sends the session summary.

## Files

- `UPDATE: packages/sdk/src/host.ts:1177-1197` - read the worker chats' reduced state beside `held.chats`; the precedence; the driving chat's activity wherever the summary's `activity` is built.
- `UPDATE: packages/sdk/src/host.ts:2987-2998` - call `summaryMoved(ref.session)` when the worker's status or activity changed.
- `UPDATE: packages/sdk/test/subagent-chat.test.ts`, `packages/sdk/test/host.test.ts` - the cases below.

## Steps

1. The comment on `statusOf` says the rule it follows, not where it came from.

## Validation

- A worker running after the lead turn completed: the session summary reads `InProgress` with the worker's activity, then `Idle` once the worker ends, each announced; it fails first.
- A worker asking while the lead runs reads `InputNeeded`.
- A forked chat running while the lead is idle reads `InProgress`.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

- **Done:** in `packages/sdk/src/host.ts`, a new `drivingOf(held)` picks the chat that decides a session's status: the lead chat, replaced by any held chat or worker chat (the reduced `state` of each `subagents` entry whose session is this one) whose status outranks it, with `InputNeeded` > `Error` > `InProgress` > idle (`urgency`, over the activity bits only, so `IsRead` and `IsArchived` never count).
- `statusOf` returns the deciding chat's status with the host's flags; the lead's status is kept as it is when the lead decides, as before.
- `activityOf`, which builds the summary's `activity` in `summaryOf`, the catalogue listing and the session snapshot, returns the deciding chat's activity; its three call sites are unchanged.
- `sendSubagent` calls `summaryMoved(ref.session)` when the worker's reduced `status` or `activity` moved.
- **Tests:** in `packages/sdk/test/subagent-chat.test.ts`, with a new `busy()` fake and `busyHost()` helper: "reads a session as running while its worker runs after the lead turn, and idle once it ends" (the last `root/sessionSummaryChanged` reads `InProgress` with the worker's `Reading files`, then `Idle` with `activity: null`), "reads a session as waiting while its worker asks, though the lead is running" (`InputNeeded`), "reads a session as running while a second chat runs and the lead is idle" (`InProgress` with that chat's activity).
- **Failed first:** the worker case read `Idle` (1) where `InProgress` (8) was expected, the asking case `InProgress` (8) where `InputNeeded` (24) was, and the second-chat case `Idle` (1) where `InProgress` (8) was.
- **Departures:** all three cases are in `subagent-chat.test.ts`, whose fakes can run a worker and a second chat without the Claude SDK mock; none were added to `host.test.ts`. The second chat is a peer chat made by `createChat` with no source, not a fork; the status path does not tell them apart.
- **Gates:** `pnpm typecheck` clean; `pnpm boundary` clean; the first full `pnpm test` was 1569 passed, 2 failed of 1571: `agent-cofold-tools.test.ts` "still sends the after when the person declines the edit" and "sends the after for an edit still waiting when the turn is cancelled", both timing out in the file's `when` wait under load; the file alone passed 27 of 27, and a second full run was 1571 passed of 1571 in 108 files.
