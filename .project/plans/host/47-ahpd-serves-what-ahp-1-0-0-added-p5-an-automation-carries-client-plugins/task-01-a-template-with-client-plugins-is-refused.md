---
title: A template that names client plugins is refused while the host does not advertise them
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/actions.ts#L403-L423](../../../../packages/sdk/src/host/actions.ts#L403-L423) - where a create or update is handed to the store"
  - "[code://packages/sdk/src/host/handshake.ts#L231](../../../../packages/sdk/src/host/handshake.ts#L231) - the advertised automation capabilities"
  - "[code://packages/sdk/test/automations.test.ts#L228-L256](../../../../packages/sdk/test/automations.test.ts#L228-L256) - a create and a patch through a client"
---

## Objective

An `automation/createRequested` whose `definition.session.customizations`, or an `automation/updateRequested` whose `changes.session.customizations`, is a non-empty array is refused with a sentence saying this host does not load client plugins, the store is not called, and the advertised capabilities still have no `customizations`.

## Files

- `UPDATE: packages/sdk/src/host/actions.ts:403-423` - the check before `store.create` and `store.update`.
- `UPDATE: packages/sdk/test/automations.test.ts` - the cases below.
- `UPDATE: docs/AHP.md` - the automation rows: client plugins on a template are refused, and `customizations` is not advertised.

## Steps

1. Read `session.customizations` off the definition or the changes; absent or an empty array passes.
2. Refuse with `no('This host does not load client plugins, so an automation cannot carry them')` and return.

## Validation

- `packages/sdk/test/automations.test.ts`: a create with one client plugin in `session.customizations` is refused and no `automation/set` follows; an update adding one to an existing automation is refused and the entry is unchanged; a create with `customizations: []` and one with no `customizations` are accepted; the `initialize` result's `automations` capability has no `customizations` key.
- `pnpm test` passes.

## Resume

- **Status:** implemented, awaiting review.
- **Done:** [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) refuses a create or a patch whose `session.customizations` is a non-empty array. The refusal is `This host does not load client plugins, so an automation cannot carry them`. It comes before `store.create` and `store.update`, and sits after host/44 p2's `disableConditionsProblem` check at the same place, so both hold and neither reaches the store.
- **Files:** `docs/AHP.md` carries the refusal on `automation/createRequested` and `automation/updateRequested`. The `initialize` row now says the advertised `automations` holds `create` and `schedules` and no `customizations`.
- **Tests:** `packages/sdk/test/automations.test.ts` gained the `a template that names client plugins` block. A create carrying one is refused, no `automation/set` goes out, and the catalogue stays empty. A patch adding one is refused, and the entry keeps no `customizations`. An empty list and an absent one are both accepted. The `initialize` result's `automations` is `{ create: {}, schedules: {} }`, with no `customizations` key.
- **Watch out for:** the check reads `session.customizations` off whatever the action carried. A patch that names no `session` is a patch about something else and passes, as a patch should.
