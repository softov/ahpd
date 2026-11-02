---
title: A nested turn says how long it ran
status: todo
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/sessions/nested.ts#L568-L615](../../../../packages/sdk/src/sessions/nested.ts#L568-L615) - `fail` and `halt`"
---

## Objective

A turn the nested proxy ends because the inner host failed carries the time it ran.

## Files

- `UPDATE: packages/sdk/src/sessions/nested.ts:465-470` - when the outer turn began.
- `UPDATE: packages/sdk/src/sessions/nested.ts:568-615` - both endings say the turn's duration.
- `UPDATE: packages/sdk/test/nested-process.test.ts` - a killed inner host's turn says a duration.

## Steps

1. Note when the outer turn begins.
2. End a failed or halted turn with the time since then.
3. Read the duration in the case that kills the inner host mid-turn.

## Validation

- `packages/sdk/test/nested-process.test.ts`: the changed case fails on `89ebe4d5` and passes after.
- `pnpm run typecheck` is clean.

## Resume
