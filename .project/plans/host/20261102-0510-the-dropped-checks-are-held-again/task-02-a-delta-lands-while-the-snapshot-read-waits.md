---
title: A delta lands while the snapshot read waits
status: done
depends: []
layer: "sdk test"
refs:
  - "[code://packages/sdk/test/host-deltas.test.ts#L145-L203](../../../../packages/sdk/test/host-deltas.test.ts#L145-L203) - the awaited snapshot case"
---

## Objective

A late client subscribes while the session's record is read, and the chat speaks before the read answers.
The words it said then are the snapshot's, and only what came after follows.

## Files

- `UPDATE: packages/sdk/test/host-deltas.test.ts:203` - a case after the awaited snapshot case.

## Steps

1. Give the backend a workers read whose first call waits on the case and whose later calls answer at once.
2. Subscribe the late client, and check its read is the one waiting.
3. Start a turn, which resumes the session, and stream `held` while the read still waits.
4. Finish the read, stream ` more`, and hold the snapshot to `held` and what follows to ` more`.
5. Make `subscribe` read `fromSeq` before the wait, and run the new and main's cases against it.

## Validation

- The case passes on main's host, with the read unanswered when `held` streams.
- With `fromSeq` read before the wait, the new case fails, and main's cases pass.

## Resume

Done 2026-11-02 in `1e1e2492`; [implemented.md](implemented.md) says what was verified.
