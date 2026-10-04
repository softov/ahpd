---
title: A URI a client published is routed by one file
status: done
depends: [task-01-routing.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L727-L909](../../../../packages/sdk/src/host.ts#L727-L909) - `ownId`, `claimsId`, `ownerOf`, `ask`, `clients`, `relayed`, `elsewhere`"
---

## Objective

`host/relay.ts` exports `createRelay(ctx: HostContext): Relay`, which owns `relayed` and offers `clients`, `ownerOf`, `ask` and `elsewhere`; `host.ts` returns the same `clients` object on the `Host`.

## Files

- `CREATE: packages/sdk/src/host/relay.ts` - `Relay`, and `ownId`, `claimsId`, `ownerOf`, `ask`, `clients`, `relayed`, `elsewhere`.
- `UPDATE: packages/sdk/src/host.ts:727-909` - removed; `Object.assign(ctx, createRelay(ctx))`; the `clients` member of the returned `Host` is `ctx.clients`.
- `UPDATE: packages/sdk/src/host/context.ts` - the `Relay` fields.

## Steps

1. Move the declarations with their comments into the factory, unchanged.
2. `relayed` is a `Claiming` over the shared `claims`, so it reads `ctx.claims` and `relayed` is offered for the dispatch branch that reads it.
3. Keep `presence` and `watches` in `host.ts`; they are not the relay's.

## Validation

- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass; `test/clients.test.ts` and `test/uri-resources.test.ts` cover the relay.
- `wc -l packages/sdk/src/host.ts` recorded.

## Resume
