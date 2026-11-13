---
title: The two cases wait on what they read
status: implemented
depends: []
layer: "sdk tests"
refs:
  - "[code://packages/sdk/test/host-tools.test.ts](../../../../packages/sdk/test/host-tools.test.ts) - the dropped-client case"
  - "[code://packages/sdk/test/changes-refresh.test.ts](../../../../packages/sdk/test/changes-refresh.test.ts) - `openInTree`"
---

## Objective

The dropped-client case reads the owner inside its window, and `openInTree` takes a failed `git` read as a tree not there yet.

## Files

- `UPDATE: packages/sdk/test/host-tools.test.ts` - the window is 1000 ms.
- `UPDATE: packages/sdk/test/changes-refresh.test.ts` - `openInTree` catches a failed read in its wait.
- `DELETE: .project/problems/a-dropped-client-case-loses-its-window-on-windows.md`.
- `UPDATE: .project/problems/git-cases-time-out-on-windows.md` - the third case is fixed.

## Steps

1. Set `clientToolCallDisconnectTimeoutMs` to 1000 in the dropped-client case.
2. In `openInTree`, wait on a read that answers `false` when `git` fails.
3. Delete the dropped-client problem, and note the fix in the git-cases problem.

## Validation

- The two cases pass.

## Resume

Implemented 2026-11-13. See [implemented.md](implemented.md).
