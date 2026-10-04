---
title: Starting a backend's session and its workers is one file
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L1124-L1144](../../../../packages/sdk/src/host.ts#L1124-L1144) - `absorb`"
  - "[code://packages/sdk/src/host.ts#L2214-L2268](../../../../packages/sdk/src/host.ts#L2214-L2268) - the call stamps"
  - "[code://packages/sdk/src/host.ts#L3519-L3687](../../../../packages/sdk/src/host.ts#L3519-L3687) - the worker chats, titles and providers"
  - "[code://packages/sdk/src/host.ts#L3688-L4099](../../../../packages/sdk/src/host.ts#L3688-L4099) - `spawn`"
---

## Objective

`host/spawn.ts` exports `createSpawn(ctx: HostContext): Spawn` with the declarations above unchanged, and every session starts as it does today.

## Files

- `CREATE: packages/sdk/src/host/spawn.ts` - `absorb`, `unstamped`, `withWorkerUri`, `stampedCalls`, `withSender`, `describedSub`, `endedWorkers`, `sendSubagent`, `openSubagent`, `formerChatUri`, `titleOf`, `keepTitle`, `keepProvider`, `spawn`, and whatever plugin/29 added beside `stampedCalls`.
- `UPDATE: packages/sdk/src/host.ts` - those removed; the factory built after the catalogue.

## Steps

1. Move each declaration with its comment, unchanged but for indentation; `describedSub` and `endedWorkers` move into the factory.
2. What the bodies read comes off `ctx`: shared maps and options at the top of the factory, another area's functions and every `let` as `ctx.<name>` where used; the area's offered fields are added to `host/context.ts`.
3. The factory's result is assigned onto `ctx`; `host.ts` destructures `spawn`, `openSubagent`, `sendSubagent`, `withSender`, `stampedCalls`, `withWorkerUri`, `unstamped`, `absorb`, `titleOf`, `keepTitle`, `keepProvider`, `formerChatUri`.

## Validation

- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass with no test changed, the backend packages' suites included.
- `wc -l packages/sdk/src/host.ts` recorded.

## Resume
