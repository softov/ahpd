---
title: Events, paths and options are per plugin copies
status: todo
depends: [task-01-a-principal-cannot-be-changed.md]
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/plugins.ts#L725-L740](../../../../packages/sdk/src/plugins.ts#L725-L740) - `raise` hands one event to every listener"
  - "[code://packages/server/src/plugins.ts#L740-L760](../../../../packages/server/src/plugins.ts#L740-L760) - the context with the daemon's `paths` array"
  - "[code://packages/server/src/plugins.ts#L600-L645](../../../../packages/server/src/plugins.ts#L600-L645) - `secretAtUse` nodes passed as they are"
---

## Objective

One listener cannot change the event the next listener reads, and one plugin cannot change the daemon's `paths` or its configured options.

## Files

- `UPDATE: packages/sdk/src/plugins.ts:725-740` - `raise` freezes one copy of the event and hands it to every listener.
- `UPDATE: packages/server/src/plugins.ts:740-760` - `paths` is a frozen copy per plugin; the context object is frozen.
- `UPDATE: packages/server/src/plugins.ts:600-645` - `secretAtUse` nodes are copied like the rest.
- `UPDATE: packages/sdk/test/plugin-boundary.test.ts` and `packages/server/test` - the cases below.

## Steps

1. Write the tests below; they fail.
2. Copy and freeze at each site.
3. Run the full suite.

## Validation

- Listener A sets `event.listening.port`: throws, and listener B reads the host's port.
- A plugin that pushes to `context.paths` throws, and the daemon's status lists the same paths.
- A plugin that writes to a `secretAtUse` option node throws, and the root config is unchanged.
- `npx vitest run` passes.

## Resume
