---
title: The host lists its trigger types and presets
status: done
depends: [task-02-the-rule-engine-matches-a-rule.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/automations.ts#L382](../../../../packages/sdk/src/automations.ts#L382) - `triggers`"
---

## Objective

`listAutomationTriggerDefinitions` answers the `session` and `watch` types, and an automation with a bad trigger config is refused when it is saved.

## Files

- `CREATE: packages/sdk/src/triggerpresets.ts` - the five presets, each a function from its numbers to a `SessionRule`.
- `UPDATE: packages/sdk/src/automations.ts:333` - list the two types with their events and config schemas.
- `UPDATE: packages/sdk/src/automations.ts` - check each event trigger's config on create and update.
- `UPDATE: packages/sdk/src/scheduled.ts:359` - answer the types from the store underneath, which is the one the daemon is built over.
- `CREATE: packages/sdk/test/trigger-types.test.ts` - the cases below.

## Steps

1. List `session` with the eight event kinds as its events, and a config schema for the rule without `on`.
2. List `watch` with one event per preset, and a config schema of the preset's numbers and `filter`.
3. Write the five presets with these defaults:
   - looks stuck: the same tool and input 3 times.
   - failing tools: 3 failures in a row.
   - long silent turn: a turn running 10 minutes.
   - idle after failure: a failed turn, then 3 minutes of quiet.
   - waiting while busy: a queued message after 3 tool calls in the turn.
4. Refuse a config that the schema refuses, with one sentence that names the field.
5. Refuse a duration that does not read as seconds, minutes or hours, with `durationMs` from task 02.
6. Take a rule that names a session's folders or whether a run made it, which every event carries. Take one whose `when.turnLongerThan` is a duration that reads.

## Validation

- `it('lists the session and watch trigger types with their events')`
- `it('answers the same types from the store the daemon is built over')`
- `it('builds each preset into a rule with its default numbers')`
- `it('refuses a trigger whose count is not a positive number')`
- `it('refuses a duration it cannot read')`
- `it('refuses a preset number below one')`
- `it('takes a rule about a folder, a run-made session or a turn length')`
- `it('refuses a patch that carries a rule it cannot honour')`
- Run the full gates from the plan. All pass.

## Resume

Built. `EVENT_TRIGGERS` in `automations.ts` lists `session` over the eight event kinds, and `watch` over the five presets. Each comes with the config schema a client draws its form from. A session rule has `filter`, `count`, `then` and `when`, and a watch has the preset's own numbers plus `filter`. `checkTriggers` runs on create and on any update that carries `triggers`. It throws one sentence naming the field. An unknown key is refused, and so is a `count.n` that is not a whole positive number. A duration `durationMs` cannot read is refused too, `when.turnLongerThan` among them. The store's throw is what the host turns into a refusal. The `AutomationStore.triggers` port now returns `AutomationTriggerDefinition[]`, so `scheduled.ts` answers the types of the store underneath rather than an empty list.

Eight cases in `test/trigger-types.test.ts` pass, including `it('takes a rule about a folder, a run-made session or a turn length')`. The presets are five: `looks-stuck`, `failing-tools`, `long-silent-turn`, `idle-after-failure` and `waiting-while-busy`. A preset's own numbers are checked as well as the rule they build. A minute below one is refused, and so is a number the preset cannot read. The refusal names the field, the way a rule's own count does.

`filter.folders`, `filter.automated` and `when.turnLongerThan` were refused at first, because no event carried them and a rule nothing could answer is worse than a refusal. Softov settled both halves on 2026-10-07. The host puts the folders and the flag on every event, and the engine times a long turn from the start the host hands it. So the schema carries all three, and a `turnLongerThan` that is not a duration is still refused.

