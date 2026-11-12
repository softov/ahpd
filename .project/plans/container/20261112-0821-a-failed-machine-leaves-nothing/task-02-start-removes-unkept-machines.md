---
title: Start removes unkept machines
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/plugin.ts#L1543-L1549](../../../../packages/computer/src/plugin.ts#L1543-L1549) - `adopt`"
---

## Objective

At start, `adopt` removes a disposable machine with this daemon's `ahpd.host` label whose session this daemon does not keep.

## Files

- `UPDATE: packages/computer/src/plugin.ts:1543-1549` - the `mine` branch removes the machine in place of leaving it.
- `UPDATE: packages/computer/test/` - cases for this daemon's machine and for another daemon's.

## Steps

1. In `adopt`, split the branch for a disposable machine whose session is not kept into `mine` and not `mine`.
2. For `mine`, call the plugin's remove for the machine and log one line that names it and its session.
3. Keep the log line for another daemon's machine as it is.
4. Write the cases.

## Validation

- The new cases: `adopt` removes this daemon's unkept machine with its volume, and keeps another daemon's.
- `pnpm typecheck` and the computer suite pass.

## Resume
