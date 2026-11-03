---
title: The host takes the sensitive edit locations
status: done
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/common.ts#L36-L53](../../../../packages/sdk/src/host/common.ts#L36-L53) - `HOSTS_OWN`, the keys this host answers"
  - "[code://packages/sdk/src/host/sessionconfig.ts#L291-L304](../../../../packages/sdk/src/host/sessionconfig.ts#L291-L304) - `hostSchema`, the rows of what this host answered"
  - "[code://packages/sdk/src/host/sessionconfig.ts#L412-L422](../../../../packages/sdk/src/host/sessionconfig.ts#L412-L422) - `sessionSchema`, every session's schema"
  - "[code://packages/sdk/src/host/chatactions.ts#L1027-L1053](../../../../packages/sdk/src/host/chatactions.ts#L1027-L1053) - the keys the backend is asked about, and the answer"
  - "[code://packages/sdk/test/autoapproval.test.ts#L86-L127](../../../../packages/sdk/test/autoapproval.test.ts#L86-L127) - a session's start and its command check"
---

## Objective

Every session's schema declares `sensitiveEditLocations` as the reference host's property.
A client's change of it is taken by the host on a running session, said back and kept, and never reaches a backend.
A redirect whose destination is in one of the locations is not approved without a question.

## Files

- `UPDATE: packages/sdk/src/host/common.ts:36-53` - `HOSTS_TAKEN`, the property of each key this host takes and reads.
- `UPDATE: packages/sdk/src/host/sessionconfig.ts:291-304` - a row for a key this host takes, and its value said back.
- `UPDATE: packages/sdk/src/host/sessionconfig.ts:412-422` - every session's schema declares the keys this host takes.
- `UPDATE: packages/sdk/src/host/chatactions.ts:1027-1053` - such a key is taken without asking the backend, and kept with this host's answers.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:1024-1025` - `backendsOwn` leaves such a key out.
- `UPDATE: packages/sdk/src/host/spawn.ts:948-974` - `getAutoApproval` hands the session's locations to the check.
- `UPDATE: packages/sdk/src/access/commandautoapprover.ts:660-700` - a redirect into a location is not approved.
- `UPDATE: packages/sdk/test/commandautoapprover.test.ts:431-500` - a redirect into a folder or a file location asks.
- `UPDATE: packages/sdk/test/autoapproval.test.ts:86-127` - the host takes the key and the check reads it.
- `UPDATE: docs/sdk/AHP.md:256` - the `session/configChanged` row.

## Steps

1. Declare the property in `HOSTS_TAKEN` as the reference host's schema has it.
2. Lay the property into every session's schema.
3. Keep the key out of the backend's questions, and hold its value with this host's answers.
4. Keep the key out of the config a backend gets at its start.
5. Read the session's locations in `getAutoApproval`, keeping each entry of the right shape.
6. Refuse approval to a redirect into a location, read as the reference host reads one.
7. Add the approver's cases and the host's case.
8. Describe the key in the `session/configChanged` row.

## Validation

- `packages/sdk/test/commandautoapprover.test.ts` and `packages/sdk/test/autoapproval.test.ts`: the new cases fail on `65132a70` and pass after.
- The sdk test files that read a session's config pass.
- `pnpm run typecheck` is clean.

## Resume

Built 2026-11-02.

- On `65132a70`'s sources the approver's case fails, the redirect approved, and the host's case fails, the key refused.
- `example.test.ts` moved with the behavior: the echo backend's form lists the host's key beside `voice`.
- `UPSTREAM.md` ticks the key's entry.
