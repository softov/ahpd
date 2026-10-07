---
title: A plugin adds a trigger type
status: done
depends: [task-04-a-matched-rule-starts-a-run.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/plugins.ts](../../../../packages/sdk/src/plugins.ts) - the plugin API"
---

## Objective

A plugin declares a trigger type and fires its events, and an automation with that type runs on them.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts` - `registerTriggerType` and `fireTrigger` on the plugin's host.
- `UPDATE: packages/sdk/src/plugins.ts` - hand them the fold, so a type is registered and fired through the host.
- `UPDATE: packages/sdk/src/automations.ts` - list plugin types beside `session` and `watch`.
- `UPDATE: packages/sdk/src/types/host.ts` - carry what the fold gathered to the host that fires it.
- `UPDATE: packages/sdk/src/validate.ts` - check one registration before it is kept.
- `UPDATE: packages/sdk/src/host/automations.ts` - the fire reaching the automations that watch the type.
- `CREATE: packages/sdk/test/plugin-triggers.test.ts` - the cases below.

## Steps

1. Add `registerTriggerType` and `fireTrigger` to the plugin API, with the types in the plan.
2. Refuse a type name that is already registered, or that is `session` or `watch`.
3. Keep the types keyed by the plugin that registered them, so an unload can remove them later.
4. List each plugin type with its events and config schema.
5. On `fireTrigger`, start a run for each enabled automation with that type and event, under its overlap mode.
6. Put the plugin's data on `origin.event`, and use it to fill `{{event}}` and the summary block.

## Validation

- `it('lists a trigger type a plugin registered')`
- `it('starts a run when the plugin fires its event')`
- `it('refuses a second plugin with the same type name')`
- `it('refuses a name the host answers for, and a name the plugin already used')`
- `it('leaves an automation nobody owns out when the host says so')`
- Run the full gates from the plan. All pass.

## Resume

Built. `types/plugin.ts` gained `TriggerTypeDefinition`, `PluginTriggers` and the two methods on `PluginHost`. `plugins.ts` registers a type after `checkTriggerType`, and refuses `session`, `watch` and a name the plugin already used. It keeps those names in `RESERVED_TRIGGER_TYPES`. The fold gathers each plugin's types onto `options.pluginTriggers`. A name two plugins both claim is reported as a problem line, and deleted from the loser. `validate.ts` gained `checkTriggerType`.

`host/automations.ts`: `watchFor` records the `type` and `events` a definition names, whether or not the host has a rule for the type. It puts a plugin's own event title on the wake. The hourly cap moved into `counted`. `fired` starts a run per watching automation, with the plugin's data on `origin.event` and the registered title in the facts. `createAutomations` sets `deliver` on each relay, and the listing appends `pluginTriggerTypes`.

Files the task did not name: `types/host.ts` carries `pluginTriggers` through to the host, and `host/automations.ts` is where a fire lands. A fire is offered to every automation watching its type, under the answer a rule's own match passes. Whose the automation is decides whether this host lets it see sessions at all. So a fire starts no run for an automation the host has been told to leave alone. One nobody owns runs only where the daemon offers such automations every session. Past that a fire passes the hourly cap and the overlap mode like any other wake. `beginAutomation` re-checks the owner at run creation. Step 6, unloading a plugin, waits in `deferred.md`: it needs the loader to say when a plugin goes, which is not this plan's change.

