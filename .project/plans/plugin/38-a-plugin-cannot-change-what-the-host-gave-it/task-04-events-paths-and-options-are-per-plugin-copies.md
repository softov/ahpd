---
title: Events, paths and options are per plugin copies
status: implemented
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

Implemented 2026-10-08, at the three sites the task names. `raise` copies the event once and hands that one frozen copy to every listener, so a listener that writes to it is refused where it stands - reported against its plugin, the rest carrying on - and the next listener still reads what the host said. The event the host built is neither frozen nor moved. `loadOne` now builds the context it passes to `pluginHost` as a frozen `PluginContext` with `paths: frozenCopy(options.paths)`, so each plugin gets its own copy of the listing the daemon serves rather than the daemon's own array, which the status line reads. `resolveSecrets` copies a `secretAtUse` node like every other one, so a plugin that writes into the node it reads itself changes nothing that configuration wrote.

One site beyond the task's list, on the same reasoning. `PluginHost` extends `PluginContext`, so the object a plugin registers through is the context it holds: the server's frozen literal only covers the object listeners capture, and `pluginHost` spreads it into the plugin's own `host`. That object is frozen where it is built, in `packages/sdk/src/plugins.ts`, which is what makes a write to `host.path` or `host.log` throw for the plugin itself.

Tests: two in `packages/sdk/test/plugin-boundary.test.ts` (the frozen context a `pluginHost` hands out; two listeners and one event, where the first listener's write is reported in its own name and the second reads the port the host bound, with the host's own event left alone). Two in `packages/server/test/plugin-load.test.ts`, each with a new fixture: `plugin-push` writes to the context and then pushes to `paths` (both refused, the load costs it a line, and the array the daemon was given is unchanged), and `plugin-later` writes into its `secretAtUse` node (refused, and the options object configuration handed in is as it was).

Verified: `npx vitest run packages/sdk/test/plugin-*.test.ts packages/sdk/test/plugins-close.test.ts packages/sdk/test/trigger-types.test.ts packages/sdk/test/automations.test.ts` - 156 passed. `npx vitest run packages/server/test/plugin-*.test.ts packages/server/test/daemon-backend.test.ts packages/server/test/uri-resources-plugin.test.ts` - 196 passed, including the daemon case that checks a plugin is handed every path the daemon serves.
