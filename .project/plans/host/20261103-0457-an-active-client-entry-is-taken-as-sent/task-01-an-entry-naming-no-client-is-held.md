---
title: An entry naming no client is held as sent
status: todo
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/actions.ts#L831-L871](../../../../packages/sdk/src/host/actions.ts#L831-L871) - the entry, given the sender's id"
  - "[code://packages/sdk/src/host.ts#L1321-L1331](../../../../packages/sdk/src/host.ts#L1321-L1331) - `leaves`"
---

## Objective

A `session/activeClientSet` whose entry carries no `clientId` is held, echoed and shown as sent.
A client's leaving takes out the entry under its own id, and leaves an entry naming no client.

## Files

- `UPDATE: packages/sdk/src/host/actions.ts:831-871` - the entry as sent, held under the `clientId` it carries.
- `UPDATE: packages/sdk/src/host.ts:258-272` - the presence map keyed by the `clientId` an entry carries.
- `UPDATE: packages/sdk/src/host.ts:1321-1331` - the removal names the leaving client's own id.
- `UPDATE: packages/sdk/src/host/context.ts:274-275` - the presence map's type.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:1069-1074` - a creator's entry under the presence map's type.
- `UPDATE: packages/sdk/test/presence.test.ts:316-345` - an entry naming no client, held as sent and left by the sender's leaving.
- `UPDATE: docs/sdk/AHP.md` - the `session/activeClientSet` row.

## Steps

1. Hold the entry as sent, under the `clientId` it carries.
2. Key the presence map by that `clientId`, absent included.
3. Name a leaving client's removal by its own id.
4. Add the case of an entry naming no client.
5. Describe the entry in the `session/activeClientSet` row.

## Validation

- `packages/sdk/test/presence.test.ts`: the new case fails on `cde4dd6c` and passes after.
- The presence test file passes.
- `pnpm run typecheck` is clean.

## Resume

Not started.
