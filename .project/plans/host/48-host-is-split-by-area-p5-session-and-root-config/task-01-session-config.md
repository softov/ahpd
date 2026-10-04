---
title: A session's config and schema are one file
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L4400-L4637](../../../../packages/sdk/src/host.ts#L4400-L4637) - `SEEDS`, `isolating`, `mergedConfig`, `hostSchema`"
  - "[code://packages/sdk/src/host.ts#L4875-L5110](../../../../packages/sdk/src/host.ts#L4875-L5110) - `propertyOf` to `mineOf`"
---

## Objective

`host/sessionconfig.ts` exports `createSessionConfig(ctx: HostContext): SessionConfig` with the declarations above unchanged.

## Files

- `CREATE: packages/sdk/src/host/sessionconfig.ts` - the declarations above.
- `UPDATE: packages/sdk/src/host.ts:4400-4637`, `:4875-5110` - removed; the factory built after machines.

## Steps

1. Move each declaration with its comment, unchanged but for indentation; `droppedSaid` moves into the factory.
2. What the bodies read comes off `ctx`: shared maps and options at the top of the factory, another area's functions and every `let` as `ctx.<name>` where used; the area's offered fields are added to `host/context.ts`.
3. The factory's result is assigned onto `ctx`; `host.ts` destructures every function another area calls.

## Validation

- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass with no test changed.
- `wc -l packages/sdk/src/host.ts` recorded.

## Resume
