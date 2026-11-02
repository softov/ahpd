---
title: Canvases and changesets say each change
status: done
depends: []
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/canvases.ts#L213-L223](../../../../packages/sdk/src/host/canvases.ts#L213-L223) - `closeAll` drops a canvas whose plugin left, its `url` kept"
  - "[code://packages/sdk/src/host/changesets.ts#L607-L614](../../../../packages/sdk/src/host/changesets.ts#L607-L614) - a failed read puts the old status back"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-canvas/state.ts#L49-L50 - hosts clear `url` when the provider becomes unavailable"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-changeset/state.ts#L119-L141 - a failed computation is `error`, with its cause"
---

## Objective

A canvas whose plugin goes away tells its own channel that its source is gone.
A changeset whose recomputation fails says `error` with the cause, instead of the status it had.

## Files

- `UPDATE: packages/sdk/src/host/canvases.ts` - `closeAll` clears each canvas's `url` on its channel before it drops it.
- `UPDATE: packages/sdk/src/host/changesets.ts` - a read that throws says `changeset/statusChanged` with `error`.

## Steps

1. Send `canvas/stateChanged` without `url` for each canvas `closeAll` drops.
2. Send `changeset/statusChanged` with `error` and the read's message when a recomputation throws.
3. Keep the status a read that answered nothing found.

## Validation

- `pnpm exec vitest run packages/sdk/test/host-canvases.test.ts packages/sdk/test/changes-refresh.test.ts` passes.

## Resume

Done; [implemented.md](implemented.md) says what was built.
