---
title: The fold keeps the base's getters
status: implemented
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

Implemented 2026-10-08, at the fold's head. The options the fold composes now start from the base's own property descriptors - `Object.defineProperties({}, Object.getOwnPropertyDescriptors(base))` - rather than a spread, so a key the base answers through a getter stays a getter in the folded options and is read again wherever the host reads it. `agents` is still copied explicitly onto the result, so the base's own array is never appended to. The daemon's `mcpServers` is the case that made this visible: `run.ts` holds it as a getter over what root config last wrote, exactly so an edit reaches the next session without a restart, and `{ ...base }` read it once at fold time and would have fixed that value for the daemon's whole life. Nothing else changes for a base built as the daemon builds one, a literal whose other properties are ordinary enumerable data properties.

Test: one case in `packages/sdk/test/plugin-boundary.test.ts`, the new section "What the fold keeps of the base it was handed". A base whose `mcpServers` is a getter over a mutable variable is folded with no contributions, the variable is then replaced with a second server as a root-config edit would, and a session started through `createHost` on the folded options is offered the second server in its backend's `Start`. Against the spread the case fails reading the first server, which is the behaviour the task was written about; it was run that way and then with the descriptors kept.

Verified: `npx vitest run packages/sdk/test/plugin-boundary.test.ts packages/sdk/test/plugin-fold.test.ts packages/sdk/test/plugin-host.test.ts` - 58 passed. `npx vitest run packages/server/test/plugin-*.test.ts packages/server/test/daemon.test.ts packages/server/test/daemon-backend.test.ts` - 233 passed.
