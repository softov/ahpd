---
title: An entry stands in its own state
status: todo
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/catalogue.ts#L1528-L1569](../../../../packages/sdk/src/host/catalogue.ts#L1528-L1569) - `askedLeft`"
---

## Objective

A confirmation entry stands at a pending confirmation or a pending result confirmation.
A client execution entry stands while the call runs, and an authentication entry at auth-required.

## Files

- `UPDATE: packages/sdk/src/host/catalogue.ts:1528-1569` - each kind's state, and the comment that says so.
- `UPDATE: packages/sdk/test/host-input-needed.test.ts:180-191` - an entry raised for a call still being announced.

## Steps

1. Hold a confirmation entry to a pending confirmation or a pending result confirmation.
2. Hold a client execution entry to a running call.
3. Hold an authentication entry to auth-required.
4. Cover an entry whose call the chat holds as announced only.

## Validation

- `packages/sdk/test/host-input-needed.test.ts`: the new case fails on `cde4dd6c` and passes after.
- The input-needed and tools test files pass.
- `pnpm run typecheck` is clean.

## Resume

Not started.
