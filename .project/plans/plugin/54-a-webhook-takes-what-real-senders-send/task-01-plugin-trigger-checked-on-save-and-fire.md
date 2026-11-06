---
title: A plugin trigger is checked on save and at a fire
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/automations/automations.ts#L264-L276](../../../../packages/sdk/src/automations/automations.ts#L264-L276) - `checkTriggers`, which looks only in `EVENT_TRIGGERS`"
  - "[code://packages/sdk/src/automations/automations.ts#L180](../../../../packages/sdk/src/automations/automations.ts#L180) - `pluginTriggerTypes`, the plugin types the check must also read"
  - "[code://packages/sdk/src/automations/automations.ts#L226-L250](../../../../packages/sdk/src/automations/automations.ts#L226-L250) - `wrongIn`, the schema check to reuse"
  - "[code://packages/sdk/src/host/automations.ts#L1174-L1196](../../../../packages/sdk/src/host/automations.ts#L1174-L1196) - `fired`, which runs a trigger with an empty config on every fire"
  - "[code://packages/sdk/test/plugin-triggers.test.ts#L180](../../../../packages/sdk/test/plugin-triggers.test.ts#L180) - the test that makes an empty config the intended behaviour"
---

## Objective

A trigger of a type a plugin registered is checked when the automation is saved, as the host's own types are.
A config that fails the type's schema, or an event the type does not offer, is refused.
A stored trigger that fails its type's schema does not fire.

## Files

- `UPDATE: packages/sdk/src/automations/automations.ts:264-276` - `checkTriggers` reads the plugin types too.
- `UPDATE: packages/sdk/src/host/automations.ts:1174-1196` - `fired` skips a trigger whose config fails its type's schema.
- `UPDATE: packages/sdk/test/plugin-triggers.test.ts` - the cases below.

## Steps

1. Give `checkTriggers` the plugin trigger types that the store already lists.
2. Check a plugin trigger's config against its type's `configSchema` with `wrongIn`.
3. Refuse a plugin trigger event that its type does not offer, with the event id named.
4. Leave a trigger of a type no loaded plugin registers unchecked.
5. Skip a trigger in `fired` whose config fails its type's schema, and write a problem line once for it.
6. Change the test at line 180, so that an empty config fires only when the schema requires nothing.
7. Run the SDK tests, and set this task and the plan row to `implemented`.

## Validation

- `plugin-triggers.test.ts`: the host refuses a save whose webhook trigger has no `connector`, and names `connector`.
- `plugin-triggers.test.ts`: the host refuses a save whose trigger names the event `calls`.
- `plugin-triggers.test.ts`: a stored trigger with no required key does not run on a fire.
- `plugin-triggers.test.ts`: the host saves a trigger of an unloaded plugin's type.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass.

## Resume

- **Done so far:** `memoryAutomations(options: AutomationsOptions = {})` reads `pluginTypes` through a getter at every create and update, so a definition written after the plugins loaded is checked against their types and one written before them is not. `checkTriggers(definition, types)` looks the trigger's type up in the host's own two plus the plugin types, checks the config with `wrongIn` when the type carries a `configSchema`, and refuses an event id the type does not offer even when it carries no schema. `wrongIn` is exported and now refuses a missing `schema.required` key, naming the field (nested as `a.b`). `fired` in `host/automations.ts` checks each watched plugin trigger's config against its type's schema before `configMatches`, skips it when that fails, and logs `${automation} holds a ${type} trigger its type refuses (${wrong}), so this fire did not wake it` once per automation, type and sentence. `plugin-triggers.test.ts` gained a `DEPLOY` type (type `webhook`, event `call`, `connector` required), a `triggerOf` helper, and four cases: missing required field refused naming `connector`, unknown event `calls` refused, a type no plugin registers still saved, and a stored trigger with no `connector` not run on two fires with one problem line. The empty-config case is retitled to say it fires because its type requires nothing.
- **Next action:** task 02.
- **Open questions:** none.
- **Departures:** the production getter is not wired here. `run.ts` still calls `memoryAutomations()` with no options, so a plugin trigger is checked on save only where the caller passes `pluginTypes`; the test passes it. Task 02 step 11 (give the store and the channel their lookups in `run.ts`) is where the daemon gets it, and `scheduledAutomations` must forward the option there too.
- **Watch out for:** `checkTriggers` is a module function, so the store passes the plugin types to it. Event ids are now checked for a type with no `configSchema` as well, which the old `continue` skipped; no host type or test relied on that.
