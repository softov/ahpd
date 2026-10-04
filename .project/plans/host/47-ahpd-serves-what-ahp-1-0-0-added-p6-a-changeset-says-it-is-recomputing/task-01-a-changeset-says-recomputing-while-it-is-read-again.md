---
title: A changeset says recomputing while it is read again
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L2883](../../../../packages/sdk/src/host.ts#L2883) - `shown`"
  - "[code://packages/sdk/src/host.ts#L2904-L2941](../../../../packages/sdk/src/host.ts#L2904-L2941) - `told`"
  - "[code://packages/sdk/src/host.ts#L2953-L2967](../../../../packages/sdk/src/host.ts#L2953-L2967) - `contentMoved`, where the mark goes"
  - "[code://packages/sdk/test/changes-refresh.test.ts#L168-L183](../../../../packages/sdk/test/changes-refresh.test.ts#L168-L183) - `re-reads a changeset when git is changed outside the host`, the case the new ones copy"
  - "[code://docs/AHP.md#L266](../../../../docs/AHP.md#L266) - the `changeset/statusChanged` row"
---

## Objective

When `contentMoved` re-reads a changeset whose watchers were last told `ready` or `error`, they are first sent `changeset/statusChanged` with `recomputing` and no file action; when the read comes back they get `ready` and whatever files moved, and when it gives nothing or throws they get the status they had before.

## Files

- `UPDATE: packages/sdk/src/host.ts:2953-2967` - in `contentMoved`, before `options.changes?.state(...)`: when `shown.get(channel)` exists and its status is neither `computing` nor `recomputing`, dispatch `{ type: 'changeset/statusChanged', status: 'recomputing' }` and record `recomputing` in `shown`, remembering the previous status; after the read, `told` as today, or, when the read gave nothing or threw, dispatch the previous status and record it.
- `UPDATE: packages/sdk/test/changes-refresh.test.ts` - the cases below.
- `UPDATE: docs/AHP.md:266` - the row says `recomputing` is sent before a re-read and `ready` after.

## Steps

1. Add the mark and the restore in `contentMoved`; `told` is unchanged.
2. Restore in a `finally` that lets the error go on, so the caller's `catch` at `host.ts:3340` still sees the failure.

## Validation

- `packages/sdk/test/changes-refresh.test.ts`, on a real repository in a temp directory: after a watched changeset is first told, a re-read that finds the same files sends `changeset/statusChanged` `recomputing`, then `ready`, and no file action; a re-read after a new file is added outside the host sends `recomputing`, then `ready` and the file action, and the replay through `changesetReducer` keeps the old files during `recomputing`; with a fake `changes.state` that throws once, the watchers get `recomputing` then `ready` again and no file action; a channel nobody watches gets nothing.
- `pnpm test` passes.

## Resume
