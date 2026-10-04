---
title: A definition with a disable-condition kind twice is refused
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L10035-L10055](../../../../packages/sdk/src/host.ts#L10035-L10055) - where a create or update request is checked and handed to the store"
  - "[code://packages/sdk/test/automations.test.ts#L228-L256](../../../../packages/sdk/test/automations.test.ts#L228-L256) - a create and a patch through a client, the shape the new tests take"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `AutomationAfterRunsCondition`, `AutomationAfterDateCondition` (`channels-automation/state.ts:210-251`)"
---

## Objective

An `automation/createRequested` whose `definition.disableConditions`, or an `automation/updateRequested` whose `changes.disableConditions`, names a kind twice or holds a condition the host cannot read is refused with a reason, and the store is not called.

## Files

- `UPDATE: packages/sdk/src/automations.ts` - an exported pure `disableConditionsProblem(value: unknown): string | undefined`: absent is fine; otherwise an array of `{ kind: 'afterRuns', max }` with `max` a positive integer or `{ kind: 'afterDate', date }` with `date` an ISO 8601 timestamp `Date.parse` reads, each kind at most once.
- `UPDATE: packages/sdk/src/host.ts:10035-10055` - call it on the definition or the changes before the store, and `no(...)` with its sentence.
- `UPDATE: packages/sdk/test/automations.test.ts` - the cases below.
- `UPDATE: docs/AHP.md` - the automation rows say conditions are checked and a duplicate kind is refused.

## Steps

1. Write the function beside the store, so the scheduled store and the host share it.
2. Refuse in the host before `store.create` or `store.update`; the refusal names the kind repeated or the field wrong.

## Validation

- `packages/sdk/test/automations.test.ts`: two `afterRuns` are refused and no `automation/set` follows; `afterRuns` with `max: 0` or `1.5` is refused; `afterDate` with `date: 'soon'` is refused; an unknown `kind` is refused; one of each kind is accepted and echoed in the entry; an update that only renames the automation is accepted with no `disableConditions` at all.
- `pnpm test` passes.

## Resume
