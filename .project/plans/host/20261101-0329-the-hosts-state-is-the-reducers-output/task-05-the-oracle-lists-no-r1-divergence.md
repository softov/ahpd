---
title: The oracle lists no R1 divergence
status: done
depends: [01, 02]
layer: "sdk tests"
refs:
  - "[code://packages/sdk/test/ahp-test-cases.test.ts#L325-L398](../../../../packages/sdk/test/ahp-test-cases.test.ts#L325-L398) - `DIVERGES`, with 22 cases of a later subscriber served what nobody was told"
---

## Objective

The oracle's third check lists no divergence, and each entry it held failed for its stated reason before this plan's change.

## Files

- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts:213-398` - the R1 entries and their rules leave `BROKEN` and `DIVERGES`.

## Steps

1. Remove the entries that name `title`, `queuedMessages`, `modifiedAt` and `chats` under `served`.
2. Run the file against the host without this plan's change, and record each case's keys.
3. Run it against the host with the change, and check that every case passes.

## Validation

- Without the change, the 22 cases fail on the later subscriber's state, on the keys the entries named.
- With it, `pnpm exec vitest run packages/sdk/test/ahp-test-cases.test.ts` passes 647 of 647.

## Resume

Done; [implemented.md](implemented.md) says what was built.
