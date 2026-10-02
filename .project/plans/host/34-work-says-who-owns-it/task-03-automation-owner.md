---
title: An automation records its creator, and a run carries it
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/automations.ts#L14-L29](../../../../packages/sdk/src/types/automations.ts#L14-L29) - the automation shape"
  - "[code://packages/sdk/src/host.ts#L7409-L7413](../../../../packages/sdk/src/host.ts#L7409-L7413) - a manual run's origin"
---

## Objective

An automation created by a signed-in person has `owner: 'user:<id>'`, persisted; each run, scheduled or manual, carries it, and its turns take it as sender.

## Files

- `UPDATE: packages/sdk/src/types/automations.ts:14-29` - `owner?: string`.
- `UPDATE: packages/sdk/src/automations.ts` - persist `owner` in the store file; copy it onto each run.
- `UPDATE: packages/sdk/src/host.ts` - set `owner` from the creating connection's principal.

## Steps

1. An automation created before this has no owner; its runs record none.

## Validation

- `packages/sdk/test/automations.test.ts`: `owner` round-trips and reaches a run.
- `pnpm -F @ahpd/sdk test`.

## Resume

Implemented 2026-10-02.

`Automation` and `AutomationRun` carry `owner?: Owner`, `StartSession` hands it to the host, and `AutomationStore.create` takes it as a third argument - only `create`, because an automation's owner is fixed by whoever wrote it and a patch by a colleague is not a transfer. `memoryAutomations` records it at create, copies it onto every run, and puts it on the `StartSession`; `host.ts` fills it from `ownerFor(connection)` on `automation/createRequested`, and `beginAutomation` gives the session it opens that owner and the first turn that owner as sender, since there is nobody at the keyboard to send it. `runAutomation` is untouched: a run pressed by a colleague is the maker's work, because the protocol's manual origin is `{ kind: 'manual' }` and carries nobody.

Two places the task's list has differently from the tree, both taken the way the code is:

- **The file is `packages/sdk/src/scheduled.ts`, not `automations.ts`.** The memory store keeps nothing on disk, and `scheduledAutomations` is the one that writes a file. `Saved` gained `owner?: string`, written beside the definition and read back only when it is one of the four typed references, so an automation written before this - or a hand-edited row naming something else - is one nobody owns. The round-trip test is in `packages/sdk/test/scheduled.test.ts` with the other restart tests, where the other half of this store is already tested.
- **`owner` is typed `Owner`, not `string`.** The task's line says `owner?: string`, and the decision it is under fixes the spelling; task 01 typed the same field `Owner` on `SessionStore`. `string` here would put an untyped claim on the wire in every catalogue row and leave each store to police its own file, which is the argument for typing it once at the port.

Also in `host.ts`, not named in the task: `beginAutomation` calls `chat.begin` directly rather than through `beginOrRun`, so the turn's sender is recorded there. That is the same work `beginOrRun` does for a person, at the one place where the asker is an automation rather than a connection.
