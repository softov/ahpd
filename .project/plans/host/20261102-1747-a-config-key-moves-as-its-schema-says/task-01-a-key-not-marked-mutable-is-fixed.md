---
title: A key the schema does not mark mutable is fixed
status: done
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L958-L1025](../../../../packages/sdk/src/host/chatactions.ts#L958-L1025) - the fixed keys, and the keys the backend is asked about"
  - "[code://packages/sdk/src/host/sessionconfig.ts#L308-L334](../../../../packages/sdk/src/host/sessionconfig.ts#L308-L334) - `propertyOf` and what it says of a key with no `sessionMutable`"
---

## Objective

A key a schema declares is mutable only when it says `sessionMutable: true`.
Once a chat of the session has a turn, any other declared key is refused.
Before it, such a key starts the backend again with its new value.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts:958-1025` - a declared key without `sessionMutable: true` joins the fixed keys.
- `UPDATE: packages/sdk/src/host/sessionconfig.ts:308-322` - `propertyOf`'s comment says what a key with no `sessionMutable` is.
- `UPDATE: packages/sdk/test/session-fixed-key.test.ts` - a key that says nothing, before and after the first turn.

## Steps

1. Count a declared key as fixed unless its schema says `sessionMutable: true`.
2. Ask the backend about a key only when its schema says `sessionMutable: true`, or does not declare it.
3. Write in `propertyOf`'s comment that a key with no `sessionMutable` stays as the session started it.
4. Add a key with no `sessionMutable` to the test backend's schema.
5. Add a case that refuses it after the first turn, and one that restarts the backend for it before.

## Validation

- `packages/sdk/test/session-fixed-key.test.ts`: both new cases fail on `89ebe4d5` and pass after.
- The sdk test files pass.
- `pnpm run typecheck` is clean.

## Resume

Built 2026-11-02.

- `runningSchema` shows every key that does not say `sessionMutable: true` as a read-only chip, as it showed a `sessionMutable: false` key.
- The comment on `Agent.schema` says the same rule.
- On `89ebe4d5`'s sources the two new cases fail: the change was taken with no refusal, and the backend did not start again.
- The sdk, agent-claude, agent-pi and agent-cofold test files pass, each timeout under load passing alone.
