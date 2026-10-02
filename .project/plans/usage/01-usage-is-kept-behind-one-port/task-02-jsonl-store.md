---
title: A JSONL store keeps live totals
status: todo
depends: [task-01-records-and-port.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/sessions.ts#L109-L153](../../../../packages/sdk/src/sessions.ts#L109-L153) - the file store pattern"
---

## Objective

`fileUsage(folder)` appends each record as one JSON line to a file per month and type, keeps per-pool daily totals in memory, and rebuilds them from the files at start.

## Files

- `CREATE: packages/sdk/src/usage.ts` - `fileUsage`.
- `CREATE: packages/sdk/test/usage.test.ts`.

## Steps

1. Appends are serialised in one queue so two records never interleave.
2. A malformed line is skipped and reported once, not fatal.
3. Files written `0600`, like the users file.

## Validation

- `packages/sdk/test/usage.test.ts`: records add to the right pools and measures; totals survive a new `fileUsage` over the same folder; a range across two months sums both files; concurrent `record` calls lose nothing.
- `pnpm -F @ahpd/sdk test`.

## Resume
