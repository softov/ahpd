---
title: A definition with a disable-condition kind twice is refused
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/actions.ts#L403-L423](../../../../packages/sdk/src/host/actions.ts#L403-L423) - where a create or update request is checked and handed to the store"
  - "[code://packages/sdk/test/automations.test.ts#L228-L256](../../../../packages/sdk/test/automations.test.ts#L228-L256) - a create and a patch through a client, the shape the new tests take"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `AutomationAfterRunsCondition`, `AutomationAfterDateCondition` (`channels-automation/state.ts:210-251`)"
---

## Objective

An `automation/createRequested` whose `definition.disableConditions`, or an `automation/updateRequested` whose `changes.disableConditions`, names a kind twice or holds a condition the host cannot read is refused with a reason, and the store is not called.

## Files

- `UPDATE: packages/sdk/src/automations.ts` - an exported pure `disableConditionsProblem(value: unknown): string | undefined`: absent is fine; otherwise an array of `{ kind: 'afterRuns', max }` with `max` a positive integer or `{ kind: 'afterDate', date }` with `date` an ISO 8601 timestamp `Date.parse` reads, each kind at most once.
- `UPDATE: packages/sdk/src/host/actions.ts:403-423` - call it on the definition or the changes before the store, and `no(...)` with its sentence.
- `UPDATE: packages/sdk/test/automations.test.ts` - the cases below.
- `UPDATE: docs/AHP.md` - the automation rows say conditions are checked and a duplicate kind is refused.

## Steps

1. Write the function beside the store, so the scheduled store and the host share it.
2. Refuse in the host before `store.create` or `store.update`; the refusal names the kind repeated or the field wrong.

## Validation

- `packages/sdk/test/automations.test.ts`, `describe('a definition that disables itself')`: `it('takes one of each kind, and echoes them on the entry')`, `it('refuses a kind named twice, and keeps nothing')` (no `automation/set`, and the catalogue empty), `it('refuses a cap that is not a whole number of one or more')` (`max: 0` and `max: 1.5`), `it('refuses a date that is not a timestamp, and a kind it does not know')`, `it('refuses a patch whose conditions do not read, and leaves a patch about something else alone')`. A refusal is read off the wire as the `rejectionReason` on the `action` notification, through the file's `refusals(peer, channel)` helper.
- `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck`, `pnpm boundary` pass.
- `npx vitest run --maxWorkers=2 --testTimeout=10000` passes whole: 260 files, 4536 tests.

## Resume

**Implemented.** `disableConditionsProblem(value: unknown): string | undefined` is exported from `packages/sdk/src/automations.ts` beside the store, and `disableConditionsOf(value)` with it - the same conditions read into the two numbers a store acts on, which task 02 uses. `packages/sdk/src/host/actions.ts` calls the first on the definition a create carries or the `changes` a patch carries, before the store, and answers with its sentence through `no(...)`.

The two `docs/AHP.md` rows in the automation table say the conditions are checked and a kind named twice is refused.

**Departure 1.** The import of `disableConditionsProblem` was added to the top of `packages/sdk/src/host/actions.ts`, outside the `#L403-L423` the plan names. The named region is the create/update block, and the refusal itself is inside it; a file that uses a module has to import it above.
