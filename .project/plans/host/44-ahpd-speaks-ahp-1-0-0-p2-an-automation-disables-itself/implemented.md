---
title: An automation disables itself as its definition says, and a kind given twice is refused - implemented
date: 2026-10-09
refs:
  - "[code://packages/sdk/src/automations.ts](../../../../packages/sdk/src/automations.ts)"
  - "[code://packages/sdk/src/scheduled.ts](../../../../packages/sdk/src/scheduled.ts)"
  - "[code://packages/sdk/src/host/actions.ts](../../../../packages/sdk/src/host/actions.ts)"
---

An automation now stops scheduling itself after the run count or the date its `disableConditions` name.
Its entry says how many scheduled runs it has used.
A create or update that names a condition kind twice, or a condition the host cannot read, is refused.
A switched-off automation still offers `run`, and a manual run is neither refused nor counted.

## What was built

- [`code://packages/sdk/src/automations.ts`](../../../../packages/sdk/src/automations.ts) - `disableConditionsProblem` and `disableConditionsOf`. The memory store counts scheduled runs, resets the count on a fresh allowance, and disables the automation when a condition is met.
- [`code://packages/sdk/src/scheduled.ts`](../../../../packages/sdk/src/scheduled.ts) - `runCount` is saved beside the definition; `rearm` switches off an automation whose date has passed, and `catchUp` skips it.
- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) - `automation/createRequested` and `automation/updateRequested` refuse a definition with a bad condition.
- [`code://packages/sdk/src/host/automations.ts`](../../../../packages/sdk/src/host/automations.ts) - `runAutomation` answers `-32001` only when there is no automation.
- `docs/AHP.md` and `docs/AUTOMATIONS.md` - the automation rows say a switched-off automation runs by hand.

## Verified

- `packages/sdk/test/automations.test.ts` and `packages/sdk/test/scheduled.test.ts` cover the refusals, the count, the resets, the cap, the date, the file and catch-up.
- The gates passed in a review worktree on main `e551d9f`: 260 test files, 4563 tests.

## Departures from the plan

- The `afterDate` test uses 2030-01-01 rather than a date on the test clock, because the memory store reads the real time.
- `rearm` cancels the timer before and after the switch-off pass, so one timer is armed at a time.
- The test for a refused removal is retitled, because a switched-off automation now offers `remove` in both stores.
- `docs/AUTOMATIONS.md` was corrected in the review, though no task named it.

## Left for later

- Nothing.
