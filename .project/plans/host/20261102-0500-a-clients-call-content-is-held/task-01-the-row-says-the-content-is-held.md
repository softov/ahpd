---
title: The row says the content is held
status: done
depends: []
layer: "docs, sdk host"
refs:
  - "[code://docs/sdk/AHP.md#L272](../../../../docs/sdk/AHP.md#L272) - the row"
---

## Objective

The row and the two comments say the content goes to every client of the chat and the held state folds it.
The test holds the claim: a later subscriber is served the call's content.

## Files

- `UPDATE: docs/sdk/AHP.md:272` - the row's sentence on what the host holds.
- `UPDATE: packages/sdk/src/host/chatactions.ts:1864-1873` - the case's comment.
- `UPDATE: packages/sdk/test/host-tools.test.ts:1365-1408` - the action carries `turnId`, and a later subscribe reads the content.

## Steps

1. Write the row's sentence from what the host does.
2. Write the case's comment from the same.
3. Send the action with its `turnId`, and read the call's content from a later subscribe.

## Validation

- `host-tools.test.ts` passes, 80 tests.
- `rg -n "holds none of it|rather than reduced" docs packages` finds nothing about a call's content.

## Resume

Done 2026-11-02 in `c72061cd`; [implemented.md](implemented.md) says what was verified.
