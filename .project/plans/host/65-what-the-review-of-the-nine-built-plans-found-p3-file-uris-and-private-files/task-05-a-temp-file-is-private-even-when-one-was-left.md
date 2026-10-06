---
title: A temp file is private even when one was left
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/policies.ts#L326-L330](../../../../packages/sdk/src/policies.ts#L326-L330) - `writeFileSync(temporary, ..., { mode: 0o600 })`"
  - "[code://packages/sdk/src/scheduled.ts#L201-L205](../../../../packages/sdk/src/scheduled.ts#L201-L205) - the same"
  - "[code://packages/sdk/src/users.ts#L683-L693](../../../../packages/sdk/src/users.ts#L683-L693) - the same"
---

## Objective

`policies.json`, `automations.json` and the users file are `0600` after every write, whatever was at the temp path before.

## Files

- `UPDATE: packages/sdk/src/policies.ts:326-330`, `packages/sdk/src/scheduled.ts:201-205`, `packages/sdk/src/users.ts:683-693` - remove the temp path before writing it; today `mode` applies only when the file is created, so a temp left at `0644` by an older writer with the same pid keeps `0644`, and the rename makes the real file `0644`.
- `UPDATE: packages/sdk/test/policies.test.ts`, `packages/sdk/test/scheduled.test.ts`, `packages/sdk/test/users.test.ts` - the cases below.

## Steps

1. Failing case first, per file: create `<file>.<process.pid>.tmp` with mode `0644`, then save. Today the saved file is `0644`; after, `0600`.
2. Remove the temp with `force: true` before the write, in all three.

## Validation

- The three cases fail on `e1c4ccc` and pass after.
- `pnpm exec vitest run packages/sdk/test/policies.test.ts packages/sdk/test/scheduled.test.ts packages/sdk/test/users.test.ts`.

## Resume
