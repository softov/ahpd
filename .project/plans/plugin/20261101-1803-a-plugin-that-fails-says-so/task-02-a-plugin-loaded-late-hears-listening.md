---
title: A plugin loaded late hears listening
status: implemented
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/commands/run.ts#L1475-L1511](../../../../packages/server/src/commands/run.ts#L1475-L1511) - `applyNow`, where the late events are raised"
  - "[code://packages/server/src/commands/run.ts#L1808-L1821](../../../../packages/server/src/commands/run.ts#L1808-L1821) - the `listening` event raised at start, which a late one copies"
  - "[code://packages/server/src/applyplugins.ts#L136-L176](../../../../packages/server/src/applyplugins.ts#L136-L176) - the loops that unload, reload and load"
  - "[code://packages/server/src/plugins.ts#L2102-L2130](../../../../packages/server/src/plugins.ts#L2102-L2130) - `unload`, which runs the closers"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1834-L1863](../../../../packages/sdk/src/plugins/plugins.ts#L1834-L1863) - `raise`, called with one plugin's `contribution.events`"
  - "[code://docs/plugins/PLUGINS.md#L1171](../../../../docs/plugins/PLUGINS.md#L1171) - the docs of `listening` and `stopping`"
---

## Objective

A plugin that the daemon loads or reloads after its socket is open gets `listening` with the address raised at start.
A plugin that the daemon unloads or reloads while it runs gets `stopping` before its closers run.

## Files

- `UPDATE: packages/server/src/applyplugins.ts:136-176` - a hook before each unload and after each load, with the plugin's `contribution.events`.
- `UPDATE: packages/server/src/commands/run.ts:1475-1511` - `applyNow` raises `stopping` and `listening` through the hook.
- `UPDATE: packages/server/src/commands/run.ts:1808-1821` - keeps the `listening` event it raised, for `applyNow`.
- `UPDATE: docs/plugins/PLUGINS.md:1171` - says that a plugin loaded late gets `listening` and a plugin unloaded gets `stopping`.
- `UPDATE: packages/server/test/plugin-live.test.ts` - the cases in *Validation*.

## Steps

1. Add `beforeUnload(id, events)` and `afterLoad(id, events)` to `ApplyPluginsOptions`.
2. Call `beforeUnload` before each `set.unload`, in the unload loop and before a reload.
3. Call `afterLoad` after each `set.load` or `set.reload` that the apply keeps.
4. Do not call `afterLoad` for a plugin that the apply unloads again for a port or a URI scheme.
5. In `run.ts`, keep the `listening` event in a variable after the start raises it.
6. In `applyNow`, pass a `beforeUnload` that raises `stopping` to the plugin's events, with `stamp` as `onProblem`.
7. In `applyNow`, pass an `afterLoad` that raises the kept `listening` event to the plugin's events.
8. Raise nothing in `afterLoad` while the variable is empty: over stdio, or before the socket is open.
9. Update the docs paragraph on `listening` and `stopping`.

## Validation

- `plugin-live.test.ts`: a plugin enabled after start gets `listening` once, with the start's port.
- `plugin-live.test.ts`: a plugin disabled while the daemon runs gets `stopping` once, before its closer.
- `plugin-live.test.ts`: a reload gives the old copy `stopping` and the new copy `listening`.
- `plugin-live.test.ts`: a plugin loaded at start does not get `listening` a second time from a later apply.
- `pnpm --filter @ahpd/server test` passes.

## Resume

`applyPlugins` takes `beforeUnload` and `afterLoad`, and `run.ts` raises `stopping` and the kept `listening` through them.
A plugin that an apply loads and then unloads again for a port or a URI scheme hears neither event.
The way down raises `stopping` to the live handlers, not to the ones of the start.
A plugin loaded late then hears it, and one unloaded already does not hear it twice.
Five cases in `plugin-live.test.ts` cover a late load, a disable, a reconfigure, a reload and an apply that leaves a plugin as it was.
