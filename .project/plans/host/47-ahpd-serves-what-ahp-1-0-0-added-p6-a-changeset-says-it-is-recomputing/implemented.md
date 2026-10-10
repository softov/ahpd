---
title: A changeset being recomputed says so, and keeps its files - implemented
date: 2026-10-09
refs:
  - "[code://packages/sdk/src/host/changesets.ts](../../../../packages/sdk/src/host/changesets.ts)"
  - "[code://packages/sdk/test/changes-refresh.test.ts](../../../../packages/sdk/test/changes-refresh.test.ts)"
---

A client that watches a changeset now sees `recomputing` while ahpd reads the changeset again.
The files the client already has stay on screen until the read is back.

## What was built

- [`code://packages/sdk/src/host/changesets.ts`](../../../../packages/sdk/src/host/changesets.ts) - `contentMoved` sends `changeset/statusChanged` with `recomputing` before a re-read when the watchers already hold a finished result. A `finally` puts the previous status back when the read gives nothing or throws.
- [`code://packages/sdk/test/changes-refresh.test.ts`](../../../../packages/sdk/test/changes-refresh.test.ts) - `recomputing` then `ready` on an outside git change, the files unchanged in between, and the restore after an empty or failed read.
- [`code://packages/sdk/test/operations.test.ts`](../../../../packages/sdk/test/operations.test.ts) - the operation path re-reads through `contentMoved`, so its expected statuses are now `recomputing` then `computing`.
- [`code://docs/AHP.md`](../../../../docs/AHP.md) - the `changeset/statusChanged` row says when `recomputing` is sent.

## Verified

- The full gates on the review tree: schema, build, typecheck and boundary are clean, and the suite passed 4713 tests in 265 files.

## Departures from the plan

- None.

## Left for later

- Nothing.
