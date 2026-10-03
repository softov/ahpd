---
title: The commit message is read as ahpd.commit, and as ahp.commit until ahpapp moves
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/changes.ts#L1068-L1069](../../../../packages/sdk/src/changes.ts#L1068-L1069) - reads `_meta['ahp.commit']`"
  - "[code://packages/sdk/test/commit.test.ts](../../../../packages/sdk/test/commit.test.ts) - the commit operation's tests"
  - "file:///github/ahpapp/src/changeset-ops.ts - line 207, the only sender of `ahp.commit`"
---

## Objective

A `commit` invocation takes its message from `_meta['ahpd.commit']`, and from `_meta['ahp.commit']` when the new key is absent.

## Files

- `UPDATE: packages/sdk/src/changes.ts:1068-1069` - read `ahpd.commit` first, then `ahp.commit`.
- `UPDATE: packages/sdk/test/commit.test.ts` - both keys, and the new one winning when both are sent.
- `UPDATE: docs/AHP.md:675` - the key is `ahpd.commit`; `ahp.commit` is read until task 05.

## Steps

1. Read both keys at the one site.
2. Leave a comment naming task 05 as the place the old key goes.

## Validation

- `packages/sdk/test/commit.test.ts`: a message under `ahpd.commit` is the commit's subject; under `ahp.commit` it still is; with both, `ahpd.commit` wins.
- `packages/sdk/test/wire.test.ts` passes; its traffic does not send a commit, so the census is unchanged here.
- `pnpm test` passes.

## Resume
