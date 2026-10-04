---
title: The handler classification test reads every file that holds handlers
status: todo
depends: []
layer: "sdk test"
refs:
  - "[code://packages/sdk/test/users-gate.test.ts#L135-L163](../../../../packages/sdk/test/users-gate.test.ts#L135-L163) - `classifies every handler the host serves`, reading one file by indentation"
---

## Objective

`classifies every handler the host serves` finds every method in `host.ts` and in every file under `packages/sdk/src/host/`, and fails when a method is classified nowhere, before and after the handlers move.

## Files

- `UPDATE: packages/sdk/test/users-gate.test.ts:135-163` - read `host.ts` and every `.ts` under `src/host/`; match a handler key at the indentation each file uses.

## Steps

1. Record the number of handlers the test finds today; it is fewer than the 47 methods, because the bare-key pattern takes only `(params)` handlers.
2. Read the list of files with `readdirSync`; keep the two patterns, with the indent widened to the one the moved tables use (decided by the factory shape, which keeps one indent for all of them).
3. Assert the number found equals the number recorded in step 1, written as a constant with a comment saying a new method raises it.
4. Keep the existing comments; add none about the move.

## Validation

- `pnpm exec vitest run packages/sdk/test/users-gate.test.ts` passes before any handler moves.
- Deleting a key from `NEEDS` by hand makes it fail, and is reverted.

## Resume
