---
title: The fold keeps the base's getters
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/plugins.ts#L176-L181](../../../../packages/sdk/src/plugins.ts#L176-L181) - `{ ...base }` reads each getter once"
  - "[code://packages/server/src/commands/run.ts#L566-L571](../../../../packages/server/src/commands/run.ts#L566-L571) - `get mcpServers()`"
---

## Objective

A root-config edit to `mcpServers` reaches the next session without a restart, as `run.ts` intends.

## Files

- `UPDATE: packages/sdk/src/plugins.ts:180` - the options start from `Object.defineProperties({}, Object.getOwnPropertyDescriptors(base))`, so getters stay getters.
- `UPDATE: packages/sdk/test` - the case below.

## Steps

1. Write the test; it fails.
2. Keep the descriptors in the fold.

## Validation

- A base with `get mcpServers()` whose value changes after the fold: `createHost(folded)` gives the next session the new value.
- `npx vitest run` passes.

## Resume
