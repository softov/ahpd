---
title: A temp file is private even when one was left
status: done
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

`packages/sdk/src/policies.ts`, `packages/sdk/src/scheduled.ts`, `packages/sdk/src/users.ts` - each `rmSync(temporary, { force: true })` immediately before its `writeFileSync`, with the comment that `mode` applies when a file is created rather than when one is opened. Nothing else moved.

The three cases, one per file: `<file>.<process.pid>.tmp` is written and `chmodSync`'d to `0644` before the save, and the file is `0600` afterwards. What the scheduled store needed and the other two did not: a change there is written twice - once when the clock is caught up, once with the stamp - and the last of the two is what leaves the file, so the case puts the readable temp back from an `onChanged` listener, between the two. Read straight after `create` without that, the second write's own temp makes the file `0600` whatever the first one left, which is the case above it and not this one.

Verified: all three failed first with `expected 420 to be 384` (0644 against 0600); `npx tsc -b` clean; `npx vitest run packages/sdk/test/policies.test.ts packages/sdk/test/scheduled.test.ts packages/sdk/test/users.test.ts` 85 tests pass; `npx vitest run packages/sdk` 106 files, 1489 tests pass.
