---
title: No baseline for an unopened session, no title for a closed chat
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L2936-L2950](../../../../packages/sdk/src/host.ts#L2936-L2950) - the baseline for every session in the directory"
  - "[code://packages/sdk/src/host.ts#L7403-L7427](../../../../packages/sdk/src/host.ts#L7403-L7427) - `disposeChat`"
---

## Objective

A GitHub answer writes a baseline only for sessions live in this daemon; a disposed chat's title is removed from the store.

## Files

- `UPDATE: packages/sdk/src/host.ts` - the loop at 2948 and `disposeChat`.
- `UPDATE:` the host tests for baselines and chat titles.

## Steps

1. Tests first: a catalogue row never opened gets no baseline after a GitHub answer, a live one does; a disposed chat's title is gone from the store.
2. Implement.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume
