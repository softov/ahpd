---
title: A changeset says recomputing while it is read again
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/changesets.ts#L198](../../../../packages/sdk/src/host/changesets.ts#L198) - `shown`"
  - "[code://packages/sdk/src/host/changesets.ts#L219-L257](../../../../packages/sdk/src/host/changesets.ts#L219-L257) - `told`"
  - "[code://packages/sdk/src/host/changesets.ts#L268-L282](../../../../packages/sdk/src/host/changesets.ts#L268-L282) - `contentMoved`, where the mark goes"
  - "[code://packages/sdk/test/changes-refresh.test.ts#L168-L183](../../../../packages/sdk/test/changes-refresh.test.ts#L168-L183) - `re-reads a changeset when git is changed outside the host`, the case the new ones copy"
  - "[code://docs/AHP.md#L266](../../../../docs/AHP.md#L266) - the `changeset/statusChanged` row"
---

## Objective

When `contentMoved` re-reads a changeset whose watchers were last told `ready` or `error`, they are first sent `changeset/statusChanged` with `recomputing` and no file action; when the read comes back they get `ready` and whatever files moved, and when it gives nothing or throws they get the status they had before.

## Files

- `UPDATE: packages/sdk/src/host/changesets.ts:268-282` - in `contentMoved`, before `options.changes?.state(...)`: when `shown.get(channel)` exists and its status is neither `computing` nor `recomputing`, dispatch `{ type: 'changeset/statusChanged', status: 'recomputing' }` and record `recomputing` in `shown`, remembering the previous status; after the read, `told` as today, or, when the read gave nothing or threw, dispatch the previous status and record it.
- `UPDATE: packages/sdk/test/changes-refresh.test.ts` - the cases below.
- `UPDATE: docs/AHP.md:266` - the row says `recomputing` is sent before a re-read and `ready` after.

## Steps

1. Add the mark and the restore in `contentMoved`; `told` is unchanged.
2. Restore in a `finally` that lets the error go on, so the caller's `catch` at `packages/sdk/src/host/facts.ts:301` still sees the failure.

## Validation

- `packages/sdk/test/changes-refresh.test.ts`, on a real repository in a temp directory: after a watched changeset is first told, a re-read that finds the same files sends `changeset/statusChanged` `recomputing`, then `ready`, and no file action; a re-read after a new file is added outside the host sends `recomputing`, then `ready` and the file action, and the replay through `changesetReducer` keeps the old files during `recomputing`; with a fake `changes.state` that throws once, the watchers get `recomputing` then `ready` again and no file action; a channel nobody watches gets nothing.
- `pnpm test` passes.

## Resume

- `contentMoved` says `changeset/statusChanged` with `recomputing` before a re-read whose watchers already hold a result, and records the mark in `shown`.
- The read then goes through `told` as before, so `ready` and any file action follow.
- A read that answers nothing, or throws, dispatches the status from before the mark and records it again, in a `finally`. The failure goes on to `refreshWatched`'s catch.
- Four cases in `packages/sdk/test/changes-refresh.test.ts`: an unchanged re-read, one that finds a file, one whose read throws, and a channel nobody watches.
- The `changeset/statusChanged` row in `docs/AHP.md` says when each status is sent.
- Found that the plan did not know: one expectation in `packages/sdk/test/operations.test.ts` had to change. That case now sees `recomputing` then `computing`, because the operation path also re-reads through `contentMoved`.
