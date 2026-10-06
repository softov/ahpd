---
title: The handler classification test reads every file that holds handlers
status: done
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

Built 2026-10-04. `users-gate.test.ts:135` now reads `host.ts` at its own indent and every `.ts` under `src/host/` at the indent the family tables are written in, through a `handlerKeys(source, indent)` helper that keeps both the bare-key and the quoted-key patterns and the comment that says why the second exists.

Step 1's count is 45, written as `const SERVED = 45`, so a method added raises it: 32 bare keys and 13 quoted `vscode/*` keys. Two of the 47 are still missed on purpose, because they take no params (`ping` and `shutdown`, with `getNetworkDiagnosticsInfo` and `getManagedSettingsDiagnostics` among them); the constant is what the pattern finds today, not the number of keys in the literal.

Validation: the file passes 55 tests. Deleting `listSessions` from `NEEDS` in `host/gate.ts` by hand makes it fail with `['listSessions']`, and the line was put back.
