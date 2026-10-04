---
title: Root state and root config are one file
status: done
depends: [task-01-session-config.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L4100-L4190](../../../../packages/sdk/src/host.ts#L4100-L4190) - `descriptors`"
  - "[code://packages/sdk/src/host.ts#L6225-L6396](../../../../packages/sdk/src/host.ts#L6225-L6396) - `rootConfig` to `rootState`"
  - "[code://packages/sdk/src/host.ts#L2654-L2674](../../../../packages/sdk/src/host.ts#L2654-L2674) - the construction-time probe loop, which dispatches `descriptors()` and stays where it is"
---

## Objective

`host/root.ts` exports `createRoot(ctx: HostContext): Root`, which owns `rootConfig` and `restartNeeded`, and the root channel answers exactly as before.

## Files

- `CREATE: packages/sdk/src/host/root.ts` - `descriptors`, `rootConfig`, `ROOT_CONFIG_SCHEMA`, `daemonSchema`, `daemonProperties`, `daemonKey`, `restartNeeded`, `advertisedSchemes`, `rootState`.
- `UPDATE: packages/sdk/src/host.ts:4100-4190`, `:6225-6396` - removed; the factory built before the probe loop at `:2654`.

## Steps

1. Move each declaration with its comment, unchanged but for indentation.
2. `rootConfig` is offered as the same object, mutated in place by its writers as today.
3. `restartNeeded` becomes `ctx.restartNeeded`, read by `rootState` and written by its one writer in the `root/configChanged` branch at `:10147`; those two reads and one write gain the `ctx.` prefix and nothing else changes.
4. The factory's result is assigned onto `ctx`; `host.ts` destructures `descriptors`, `rootConfig`, `rootState`, `advertisedSchemes`, `daemonKey`, `daemonProperties`, `daemonSchema`.

## Validation

- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass with no test changed; `test/root-config.test.ts` covers the daemon keys and the restart flag.
- `wc -l packages/sdk/src/host.ts` recorded.

## Resume
