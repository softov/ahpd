---
title: The host's terminals are one file
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L5724-L5878](../../../../packages/sdk/src/host.ts#L5724-L5878) - `commanded`, `terminalInfo`, `heldTerminals`"
  - "[code://packages/sdk/src/host.ts#L586-L613](../../../../packages/sdk/src/host.ts#L586-L613) - `claimOf`"
  - "[code://packages/sdk/src/terminals.ts#L395](../../../../packages/sdk/src/terminals.ts#L395) - `shellTerminals`, the port, which this file does not touch"
---

## Objective

`host/terminals.ts` exports `claimOf` and `createTerminals(ctx: HostContext): Terminals` with the declarations above unchanged.

## Files

- `CREATE: packages/sdk/src/host/terminals.ts` - `claimOf`, `commanded`, `terminalInfo`, `heldTerminals`.
- `UPDATE: packages/sdk/src/host.ts` - those removed; `claimOf` imported; the factory built after tooling.

## Steps

1. Move each declaration with its comment, unchanged but for indentation.
2. The `terminals` map stays shared in `host.ts`, since `close` and the dispatch branches read it.
3. The factory's result is assigned onto `ctx`; `host.ts` destructures `commanded`, `terminalInfo`, `heldTerminals`.

## Validation

- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass with no test changed.
- `wc -l packages/sdk/src/host.ts` recorded.

## Resume
