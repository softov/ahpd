---
title: The host resolves an agent's needs for a machine maker
status: todo
depends: [task-01-the-need-type.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L134-L138](../../../../packages/sdk/src/types/plugin.ts#L134-L138) - the plugin host"
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

- `test/machine-needs.test.ts`: the three-level order, `~` expansion, a missing required need, a missing path, an unknown provider.

## Resume
