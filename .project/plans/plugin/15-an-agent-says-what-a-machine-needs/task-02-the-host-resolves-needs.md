---
title: The host resolves an agent's needs for a machine maker
status: implemented
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

Done 2026-09-26. `resolveNeeds` and `expandHome` live in `packages/sdk/src/machine.ts` and are exported from `packages/sdk/src/index.ts`. `PluginHost.machineNeeds` is declared in `types/plugin.ts` and implemented in `plugins.ts`, which reads a live agent list given as `pluginHost`'s third argument (`HostRecordingOptions.agents`). `loadPlugins` owns that list, seeds it from the base's agents and appends each contribution's agents as it loads, so nothing is read at load and everything is known at create.

Found: `machineNeeds` answers an empty record for an agent that declares nothing and `undefined` for a provider no agent has, so the computer plugin can refuse the second without treating the first as a mistake. The refusal names the need, the path and whether it came from the profile, the plugin option or the agent's default.
