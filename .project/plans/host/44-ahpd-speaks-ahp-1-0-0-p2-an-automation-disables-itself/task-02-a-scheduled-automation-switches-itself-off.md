---
title: A scheduled automation counts its runs and switches itself off
status: todo
depends: [task-01-a-definition-with-a-kind-twice-is-refused.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/automations.ts#L52-L75](../../../../packages/sdk/src/automations.ts#L52-L75) - `entry()`, where `runCount` and `operations` are built"
  - "[code://packages/sdk/src/automations.ts#L95-L125](../../../../packages/sdk/src/automations.ts#L95-L125) - `create` and `update`, where the count starts and resets"
  - "[code://packages/sdk/src/automations.ts#L60-L64](../../../../packages/sdk/src/automations.ts#L60-L64) - `entry()`'s `operations`, which drop `run` when disabled"
  - "[code://packages/sdk/src/automations.ts#L135-L138](../../../../packages/sdk/src/automations.ts#L135-L138) - `run()`'s gate, `found.definition.enabled === false` at :138"
  - "[code://packages/sdk/src/host.ts#L7282-L7290](../../../../packages/sdk/src/host.ts#L7282-L7290) - `onDue`, a scheduled run's call into `run()` with a trigger origin"
  - "[code://packages/sdk/src/host.ts#L8539-L8545](../../../../packages/sdk/src/host.ts#L8539-L8545) - `runAutomation`, a manual run's call into `run()` and its \"or it is switched off\" refusal"
  - "[code://packages/sdk/test/automations.test.ts#L258-L268](../../../../packages/sdk/test/automations.test.ts#L258-L268) - `does not offer to run one that is switched off`, which this task inverts"
  - "[code://packages/sdk/test/automations.test.ts#L477-L492](../../../../packages/sdk/test/automations.test.ts#L477-L492) - a removal test that leans on `run` being absent from a disabled entry"
  - "[code://packages/sdk/src/scheduled.ts#L36-L48](../../../../packages/sdk/src/scheduled.ts#L36-L48) - the saved shape"
  - "[code://packages/sdk/src/scheduled.ts#L179-L196](../../../../packages/sdk/src/scheduled.ts#L179-L196) - `save()`"
  - "[code://packages/sdk/src/scheduled.ts#L211-L276](../../../../packages/sdk/src/scheduled.ts#L211-L276) - `rearm()`, `fire()`, `catchUp()`"
  - "[code://packages/sdk/src/scheduled.ts#L279-L307](../../../../packages/sdk/src/scheduled.ts#L279-L307) - `load()`"
  - "[code://packages/sdk/src/types/automations.ts#L15-L55](../../../../packages/sdk/src/types/automations.ts#L15-L55) - `Automation` and `AutomationEntry`"
  - "[code://packages/sdk/src/types/automations.ts#L176](../../../../packages/sdk/src/types/automations.ts#L176) - the port's `create`"
  - "[code://packages/sdk/test/scheduled.test.ts](../../../../packages/sdk/test/scheduled.test.ts) - a test clock and timer reach a schedule without waiting"
---

## Objective

A scheduled run admitted for an automation with an `afterRuns` condition adds one to its `runCount`, and when the count reaches `max`, or the clock passes an `afterDate`, the automation is announced with `enabled: false`; the count survives a restart, resets as the protocol says, and a manual run is never counted.
A disabled automation, whatever disabled it, still offers `run` and still runs by hand; `enabled` gates scheduled runs only.

## Files

- `UPDATE: packages/sdk/src/types/automations.ts` - `runCount?: number` on `Automation` and on the entry; `create` takes an optional `runCount` after `owner`, so a store reading its file can restore it.
- `UPDATE: packages/sdk/src/automations.ts` - `entry()` offers `['update', 'remove', 'run']` whatever `enabled` says, and its comment says `enabled` governs the schedule only; `run()`'s `enabled === false` refusal at :138 applies to `origin.kind === 'trigger'` only; the count on the record; `entry()` carries it only while an `afterRuns` condition exists; `update()` resets it to `0` on `enabled` going from `false` to `true` or on `afterRuns` appearing; `run()` with `origin.kind === 'trigger'` refuses when an `afterDate` has passed, otherwise counts, and sets `enabled: false` once the count reaches `max`, announcing through `said()`.
- `UPDATE: packages/sdk/src/scheduled.ts` - `Saved` gains `runCount?`; `save()` writes the entry's, `load()` passes it to `inner.create`; `rearm()` and `catchUp()` treat an automation whose `afterDate` has passed as due for nothing, and switch it off through `inner.update` with `enabled: false`.
- `UPDATE: packages/sdk/src/host.ts:8543` - the `runAutomation` refusal says only that there is no automation at that resource, since a disabled one now runs.
- `UPDATE: packages/sdk/test/automations.test.ts`, `packages/sdk/test/scheduled.test.ts` - the cases below.
- `UPDATE: docs/AHP.md` - `disableConditions` and `runCount` move to served; the `runAutomation` row says a disabled automation runs by hand, as the protocol has it.

## Steps

1. Let a person run a disabled automation: `entry()` always offers `run`, `run()` refuses a disabled automation only for a trigger origin, and the `runAutomation` message drops "or it is switched off"; the scheduled store's own `enabled` checks in `soonest()` and `catchUp()` stay, so the schedule still stops. Invert `does not offer to run one that is switched off` into a test that a disabled automation offers `run` and `runAutomation` starts it, and in the removal test at :477 drop the `not.toContain('run')` line and the comment that leans on it.
2. Add the count to the record and the entry, then the reset rules in `update()`.
3. Count and switch off inside `run()` for a trigger origin, before the session is started, so a run that later fails or is cancelled is still counted.
4. Teach the scheduled store the date, the file field and the restore.

## Validation

- `packages/sdk/test/scheduled.test.ts`, on the test clock: `afterRuns: 2` on an every-minute schedule fires twice, then the entry reads `enabled: false`, `runCount: 2`, and no third run is due; `afterDate` one minute ahead fires once, then the automation is switched off at the next arming and fires no more; a store rebuilt from the same file reads the same `runCount`.
- `packages/sdk/test/automations.test.ts`: an automation created with `enabled: false` lists `operations` `['update', 'remove', 'run']` and `runAutomation` on it answers a run resource, while the store's `run()` with a trigger origin on it answers `undefined`; one switched off by `afterRuns` runs by hand and stays `enabled: false`; a manual run leaves `runCount` unchanged; patching `enabled: true` on a switched-off automation reads `runCount: 0`; adding `afterRuns` to one with none reads `0`; removing every condition leaves `enabled: false` and drops `runCount`.
- `pnpm test` passes.

## Resume
