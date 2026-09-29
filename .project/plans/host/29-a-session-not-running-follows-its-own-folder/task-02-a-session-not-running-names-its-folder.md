---
title: A session not running names its own folder
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L5497](../../../../packages/sdk/src/host.ts#L5497) - the lookup under `ahp-session:/<id>`"
  - "[code://packages/sdk/src/host.ts#L3478](../../../../packages/sdk/src/host.ts#L3478) - where `wheres` is written, under the row's resource"
---

## Objective

The snapshot of a session served from its transcript carries the `workingDirectories` its catalogue row listed, read under `nameOf(id)`, and the host's folder only when the row listed none.

## Files

- `UPDATE: packages/sdk/src/host.ts:5497`
- `UPDATE:` a host test with a catalogued session in a folder other than the host's.

## Steps

1. Test first: the subscribe snapshot names the row's folder; it fails on current code naming the host's folder.
2. Fix, and search for other `wheres.get(\`ahp-session:/` lookups with the same mistake.

## Validation

- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

Implemented 2026-09-29, in the `fixes-0-8-1` worktree.
The transcript snapshot in `packages/sdk/src/host.ts` reads `wheres.get(nameOf(id))`; it was the only `wheres` lookup under `ahp-session:/`.
Failing first: `names the folder its catalogue row listed, not the host's` in `packages/sdk/test/host.test.ts` got `['file:///home/softov']` for a row listed in `/github/s2cmd`; it passes after.
