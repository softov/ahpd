---
title: The dropped checks are held again - implemented
date: 2026-11-02
refs:
  - git://1e1e2492
  - "[code://packages/sdk/test/host-turn.test.ts](../../../../packages/sdk/test/host-turn.test.ts)"
  - "[code://packages/sdk/test/host-deltas.test.ts](../../../../packages/sdk/test/host-deltas.test.ts)"
---

The two checks c8a586a1 moved are held again in the form the held state can express.

## What was built

- [`code://packages/sdk/test/host-turn.test.ts`](../../../../packages/sdk/test/host-turn.test.ts) - the failed turn case reads the session's side at each step.
- The session's row for the chat and its list row go Error, InProgress and Idle with the chat.
- The session carries no error of its own at any step, the form the session-level check takes now.
- [`code://packages/sdk/test/host-deltas.test.ts`](../../../../packages/sdk/test/host-deltas.test.ts) - a case whose late subscribe waits in the record's workers read.
- A turn resumes the session through a second read, and the chat says `held` while the first read still waits.
- The snapshot holds `held`, and only ` more` follows it.

## Verified

- Both files pass on main's host, 45 tests.
- A probe stopped the session's row from following a chat in error.
- The new host-turn case fails at the next turn's start, `row: 2` against `8`, and main's case passes.
- A probe made `subscribe` read `fromSeq` before the snapshot's wait.
- The new host-deltas case fails, and main's cases pass.
- Main's two files pass all 44 tests under both probes at once.

## Departures from the plan

- none.

## Left for later

- none.
