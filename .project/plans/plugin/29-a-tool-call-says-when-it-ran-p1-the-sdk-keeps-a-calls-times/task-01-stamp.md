---
title: The sdk has one helper that builds and keeps a tool call's timing _meta
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L1810-1834](../../../../packages/sdk/src/host.ts#L1810-1834) - `stampedCalls` and `withWorkerUri`, the pattern for a `_meta` key kept across actions"
---

## Objective

A helper in the sdk builds `{startedAt, endedAt, durationMs}` from two times and merges it into a call's `_meta` beside the keys already there, so a plugin that resends `_meta` keeps both `toolKind` and the times.

## Steps

1. Failing first: the cases under Validation.
2. Stamp through the sdk helper from p1 (this task creates it).

## Validation

- `packages/sdk/test/`: merging keeps `toolKind` and the times; `durationMs` is the difference in ms; a missing end gives only `startedAt`.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
