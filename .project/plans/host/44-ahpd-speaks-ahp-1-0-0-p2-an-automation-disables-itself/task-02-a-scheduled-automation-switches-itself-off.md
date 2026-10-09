---
title: A scheduled automation counts its runs and switches itself off
status: done
depends: [task-01-a-definition-with-a-kind-twice-is-refused.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/automations.ts#L52-L75](../../../../packages/sdk/src/automations.ts#L52-L75) - `entry()`, where `runCount` and `operations` are built"
  - "[code://packages/sdk/src/automations.ts#L95-L125](../../../../packages/sdk/src/automations.ts#L95-L125) - `create` and `update`, where the count starts and resets"
  - "[code://packages/sdk/src/automations.ts#L60-L64](../../../../packages/sdk/src/automations.ts#L60-L64) - `entry()`'s `operations`, which drop `run` when disabled"
  - "[code://packages/sdk/src/automations.ts#L135-L138](../../../../packages/sdk/src/automations.ts#L135-L138) - `run()`'s gate, `found.definition.enabled === false` at :138"
  - "[code://packages/sdk/src/host/automations.ts#L233-L246](../../../../packages/sdk/src/host/automations.ts#L233-L246) - `due`, a scheduled run's call into `run()` with a trigger origin"
  - "[code://packages/sdk/src/host/automations.ts#L299-L305](../../../../packages/sdk/src/host/automations.ts#L299-L305) - `runAutomation`, a manual run's call into `run()` and its \"or it is switched off\" refusal"
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
- `UPDATE: packages/sdk/src/host/automations.ts:303` - the `runAutomation` refusal says only that there is no automation at that resource, since a disabled one now runs.
- `UPDATE: packages/sdk/test/automations.test.ts`, `packages/sdk/test/scheduled.test.ts` - the cases below.
- `UPDATE: docs/AHP.md` - `disableConditions` and `runCount` move to served; the `runAutomation` row says a disabled automation runs by hand, as the protocol has it.

## Steps

1. Let a person run a disabled automation: `entry()` always offers `run`, `run()` refuses a disabled automation only for a trigger origin, and the `runAutomation` message drops "or it is switched off"; the scheduled store's own `enabled` checks in `soonest()` and `catchUp()` stay, so the schedule still stops. Invert `does not offer to run one that is switched off` into a test that a disabled automation offers `run` and `runAutomation` starts it, and in the removal test at :477 drop the `not.toContain('run')` line and the comment that leans on it.
2. Add the count to the record and the entry, then the reset rules in `update()`.
3. Count and switch off inside `run()` for a trigger origin, before the session is started, so a run that later fails or is cancelled is still counted.
4. Teach the scheduled store the date, the file field and the restore.

## Validation

- `packages/sdk/test/scheduled.test.ts`, `describe('when the time comes') > describe('a definition that stops itself')`, on the test clock: `it('counts the runs an allowance pays for, and stops at the cap')` (`afterRuns: 2` on `* * * * *` fires twice, then `runCount` 2, `enabled: false`, no `nextRunAt`, and a third minute announces nothing), `it('switches itself off when its date has gone by, and fires no more')`, `it('keeps the count across a restart, because it is not derived from runs')` (the file carries `runCount: 3` and a second store reads it back).
- `packages/sdk/test/automations.test.ts`: `it('offers to run one that is switched off, and a press starts it')` replaces `does not offer to run one that is switched off` - `operations` is `['update', 'remove', 'run']`, `runAutomation` answers a run, and `run()` with a trigger origin answers `undefined`. `describe('a definition that stops itself')` has the count, the manual run, the two resets, the cleared conditions and the past `afterDate`.
- `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck`, `pnpm boundary` pass.
- `npx vitest run --maxWorkers=2 --testTimeout=10000` passes whole.

## Resume

**Implemented.** `Automation.runCount` is optional on the record and the entry; the entry carries it only while the definition names an `afterRuns` (`runCount ?? 0`), and `operations` is `['update', 'remove', 'run']` whatever `enabled` says. `create` takes an optional `runCount` after `owner`. `update` resets the count to `0` on a disabled-to-enabled patch or on an `afterRuns` appearing where there was none; clearing the conditions leaves the switch where it is and takes the count with it. `run()` reads `origin.kind === 'trigger'`: a disabled automation or one whose `afterDate` has passed is refused there (and switched off, through a store-local `stop()`), an admitted scheduled run adds one and switches the automation off at the cap, and a manual run is neither gated nor counted.

`runCount` is written to the scheduled store's file beside the definition, read back through `inner.create`, and the store switches off an automation whose date has gone by in `rearm()` and skips it in `catchUp()`. `packages/sdk/src/host/automations.ts` refuses `runAutomation` with `No automation at <resource>`, and its doc comment says `enabled` is not what a press is held to.

**Departure 1.** `docs/AHP.md` is left as the automation rows and one new paragraph; `docs/AUTOMATIONS.md:113` ("`run` is left out of an automation that is switched off") and `:203` ("Refused when there is no such automation or it is switched off") are now stale. Neither file is named by any task in this plan.

**Departure 2.** The `afterDate` test in `scheduled.test.ts` uses a date the real clock has not passed (2030-01-01), not one a minute ahead of the test clock: `memoryAutomations` holds no clock to inject, so its half of the comparison is against the real time, and a date in the test clock's own past is refused there before the scheduled store's arming is reached. The store underneath and the clock agree in a daemon.

**Departure 3.** `it('will not remove one the catalogue says may not be, even when asked')` is retitled `it('offers remove for one that is switched off, and removes only what it holds')`. The line this task drops was the only thing backing the old title: with `remove` offered for a disabled automation either way, the `automation/removed` gate on `operations` is unreachable through both real stores, and the body shows a removal of an unknown resource instead.

**Departure 4.** `rearm()` cancels the timer twice, before and after the switch-off pass, because switching one off announces itself and the rearm that announcement triggers arms a timer of its own. The second cancel is what keeps one timer armed at a time; the pass itself is idempotent, so the rearm that comes back through `onChanged` is what arms the clock for what is left.
