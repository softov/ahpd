---
title: The host lists its trigger types and presets
status: todo
depends: [task-02-the-rule-engine-matches-a-rule.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/automations.ts#L94](../../../../packages/sdk/src/automations.ts#L94) - `triggers`"
---

## Objective

`listAutomationTriggerDefinitions` answers the `session` and `watch` types, and an automation with a bad trigger config is refused when it is saved.

## Files

- `CREATE: packages/sdk/src/triggerpresets.ts` - the five presets, each a function from its numbers to a `SessionRule`.
- `UPDATE: packages/sdk/src/automations.ts:94` - list the two types with their events and config schemas.
- `UPDATE: packages/sdk/src/automations.ts` - check each event trigger's config on create and update.
- `CREATE: packages/sdk/test/trigger-types.test.ts` - the cases below.

## Steps

1. List `session` with the eight event kinds as its events, and a config schema for the rule without `on`.
2. List `watch` with one event per preset, and a config schema of the preset's numbers and `filter`.
3. Write the five presets with these defaults:
   - looks stuck: the same tool and input 3 times.
   - failing tools: 3 failures in a row.
   - long silent turn: 10 minutes with no tool call.
   - idle after failure: a failed turn, then 3 minutes of quiet.
   - waiting while busy: a queued message after 3 tool calls in the turn.
4. Refuse a config that the schema refuses, with one sentence that names the field.
5. Refuse a duration that does not read as seconds, minutes or hours.

## Validation

- `it('lists the session and watch trigger types with their events')`
- `it('builds each preset into a rule with its default numbers')`
- `it('refuses a trigger whose count is not a positive number')`
- `it('refuses a duration it cannot read')`
- Run the full gates from the plan. All pass.

## Resume

