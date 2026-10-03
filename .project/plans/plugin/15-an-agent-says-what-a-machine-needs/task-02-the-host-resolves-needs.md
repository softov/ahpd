---
title: The host resolves an agent's needs for a machine maker
status: done
depends: [task-01-the-need-type.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L152](../../../../packages/sdk/src/types/plugin.ts#L152) - `PluginHost.machineNeeds`"
  - "[code://packages/sdk/src/plugins.ts#L325-L328](../../../../packages/sdk/src/plugins.ts#L325-L328) - its implementation over the live agent list"
  - "[code://packages/sdk/src/machine.ts#L62-L106](../../../../packages/sdk/src/machine.ts#L62-L106) - `resolveNeeds`"
  - "[code://packages/sdk/src/computers.ts](../../../../packages/sdk/src/computers.ts) - the computers port wiring"
---

## Objective

`PluginHost.machineNeeds(provider)` answers the agent's needs, and `resolveNeeds(needs, { profile, option })` fills each from the profile, then the plugin option, then the default, expands `~`, and refuses a required need with no value or a mount whose host path does not exist.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts` - `machineNeeds`.
- `UPDATE: packages/sdk/src/plugins.ts` - its implementation over the host's agents.
- `CREATE: packages/sdk/src/machine.ts` - `resolveNeeds`.

## Steps

1. `machineNeeds` reads the agent when called, never at load.
2. The refusal names the need, the path and where the value came from.

## Validation

- `packages/sdk/test/machine-needs.test.ts`: the three-level order, `~` expansion, a missing required need, a missing path, an unknown provider.

## Resume
