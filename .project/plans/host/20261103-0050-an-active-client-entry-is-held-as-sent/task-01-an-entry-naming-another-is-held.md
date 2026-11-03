---
title: An entry naming another client is held as sent
status: done
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/actions.ts#L833-L880](../../../../packages/sdk/src/host/actions.ts#L833-L880) - the refusal, and the entry held under the sender's id"
  - "[code://packages/sdk/test/presence.test.ts#L314-L338](../../../../packages/sdk/test/presence.test.ts#L314-L338) - the refusal's case"
---

## Objective

A `session/activeClientSet` whose entry names another client's `clientId` is said to every client and held under that id.
The sender's leaving takes out its own entry and no other.

## Files

- `UPDATE: packages/sdk/src/host/actions.ts:833-880` - the refusal goes, and the entry is held under its own `clientId`.
- `UPDATE: packages/sdk/test/presence.test.ts:314-338` - the case takes the entry and keeps it after the sender leaves.
- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts:257-261` - the divergence rows of the protocol's cases 035 and 036 go.
- `UPDATE: docs/sdk/AHP.md` - the `session/activeClientSet` row.

## Steps

1. Remove the refusal of an entry naming another client.
2. Hold the entry under the `clientId` it carries, the sender's where it carries none.
3. Change the case to read the entry held and still held after the sender unsubscribes.
4. Describe the action in the `session/activeClientSet` row.

## Validation

- `packages/sdk/test/presence.test.ts`: the changed case fails on `f419294d` and passes after.
- The presence test file passes.
- `pnpm run typecheck` is clean.

## Resume

Built 2026-11-03.

- On `f419294d`'s sources the changed case fails: the entry is refused.
- The protocol's cases 035 and 036 hold as written, so their divergence rows went; on `f419294d`'s sources both fail.
- `host.ts`'s `leaves` keeps its code, and its comment names the entry under the client's own id.
