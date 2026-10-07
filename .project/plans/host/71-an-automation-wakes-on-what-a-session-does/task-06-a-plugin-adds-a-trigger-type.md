---
title: A plugin adds a trigger type
status: todo
depends: [task-04-a-matched-rule-starts-a-run.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/plugins.ts](../../../../packages/sdk/src/plugins.ts) - the plugin API"
---

## Objective

A plugin declares a trigger type and fires its events, and an automation with that type runs on them.

## Files

- `UPDATE: packages/sdk/src/plugins.ts` and `packages/sdk/src/types/plugin.ts` - `registerTriggerType` and `fireTrigger`.
- `UPDATE: packages/sdk/src/automations.ts` - list plugin types beside `session` and `watch`.
- `CREATE: packages/sdk/test/plugin-triggers.test.ts` - the cases below.

## Steps

1. Add `registerTriggerType` and `fireTrigger` to the plugin API, with the types in the plan.
2. Refuse a type name that is already registered, or that is `session` or `watch`.
3. List each plugin type with its events and config schema.
4. On `fireTrigger`, start a run for each enabled automation with that type and event, under its overlap mode.
5. Put the plugin's data on `origin.event`, and use it to fill `{{event}}` and the summary block.
6. Remove a plugin's types when the plugin unloads.

## Validation

- `it('lists a trigger type a plugin registered')`
- `it('starts a run when the plugin fires its event')`
- `it('refuses a second plugin with the same type name')`
- `it('drops the type when the plugin unloads')`
- Run the full gates from the plan. All pass.

## Resume

