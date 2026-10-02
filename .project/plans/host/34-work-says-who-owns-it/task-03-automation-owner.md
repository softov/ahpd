---
title: An automation records its creator, and a run carries it
status: todo
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
