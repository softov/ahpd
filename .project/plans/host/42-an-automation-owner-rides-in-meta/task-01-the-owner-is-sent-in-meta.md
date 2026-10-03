---
title: An automation's owner is sent in _meta
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/automations.ts#L15-L55](../../../../packages/sdk/src/types/automations.ts#L15-L55) - the two records and their `owner`"
  - "[code://packages/sdk/src/automations.ts#L52-L65](../../../../packages/sdk/src/automations.ts#L52-L65) - `entry()`"
  - "[code://packages/sdk/src/automations.ts#L136-L150](../../../../packages/sdk/src/automations.ts#L136-L150) - the run record"
  - "[code://packages/sdk/test/wire.test.ts](../../../../packages/sdk/test/wire.test.ts) - the schema check over recorded frames"
---

## Objective

No automation entry or run state a client receives has an `owner` field; the owner is `_meta['ahpd.owner']` there, and every host gate that reads an owner reads it from the stored record as before.

## Files

- `UPDATE: packages/sdk/src/automations.ts` - `entry()` and every place a run state is answered or announced build the wire object without `owner` and with `_meta: { ...given._meta, 'ahpd.owner': owner }` when there is one.
- `UPDATE: packages/sdk/src/types/automations.ts` - say on `owner` that it is the store's and is sent as `_meta['ahpd.owner']`; if the stored and the sent shapes are one type today, split the sent one so the compiler refuses `owner` on it.
- `UPDATE: packages/sdk/test/wire.test.ts` - its recorded traffic includes a host with a users directory, a signed-in person and an automation with an owner and a run; the schema check covers those frames.
- `UPDATE: docs/` - wherever automations' `owner` is documented for clients (`rg -n "owner" docs/`), it reads `_meta['ahpd.owner']`.

## Steps

1. Find every road an automation entry or a run state leaves the host: `entry()`, `summary`, the run state reads and the `automation/set` and run actions (`rg -n "entry\(|summary|byRun" packages/sdk/src/automations.ts packages/sdk/src/host.ts`).
2. Move `owner` to `_meta['ahpd.owner']` on each, at one function per shape, keeping any `_meta` already there.
3. Leave `StartSession.owner` (:171) and the host's gates alone.

## Validation

- `packages/sdk/test/wire.test.ts` with the users-directory traffic passes, and fails if `owner` is put back on the entry.
- An automations test: an automation made by `user:ana` is announced with `_meta['ahpd.owner']` and no `owner`, and its run state the same; one with no owner has neither.
- The existing tests that a run starts as its owner and that an owner who has not signed in is refused still pass.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.

## Resume
