---
title: A JSONL store keeps live totals
status: done
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

Implemented. `fileUsage` in `packages/sdk/src/usage.ts` writes `<folder>/YYYY-MM-model.jsonl` and `<folder>/YYYY-MM-computer.jsonl`, one whole record per line, and keeps `pool` then day in memory, rebuilt by reading every file of those names once at construction.

Four choices the task did not settle, each written into the code:

- **The signature is `fileUsage({ folder, onProblem })`**, not `fileUsage(folder)` as the objective's prose has it. Step 2 asks for a malformed line to be reported, and the two file stores the ref names both take an options object with an `onProblem`, so the shape follows the pattern rather than the shorthand.
- **The month and the kind are in the file name**, so a line carries no `kind` discriminator. The decision rejected one record shape with a `kind` on it, and the two records need no other way to be told apart: a record with a `model` is model use, which is the whole of the discrimination, in a private type guard.
- **A record that names no day is reported and kept nowhere**, rather than charged to a month it does not belong to or to the day it was written. There is no day to sum it by, and inventing one is a charge in the wrong place.
- **A record is charged whether or not the append succeeded.** A total that forgets a record the file holds is a limit that does not fire, which is the worse of the two.

The totals are per calendar day, which is the granularity the plan's own open question proposed, so a range is summed by the days it covers and a partly covered day counts whole. That is written down in the `Usage.total` doc as well, because a caller reading only the port should know it.

Validation: `packages/sdk/test/usage.test.ts` covers the measures one model call is charged in, a pool charged twice over by one record, a cost in another currency charged nothing, computer time as hours, a range answered by the day it covers, one file per month and kind and the totals rebuilt from them, 200 concurrent `record` calls producing 200 lines and the right total, a torn line and a line that is not a record both skipped and reported while the month survives, a record with no date reported and kept nowhere, the folder made and its files `0600`, and a folder that is not there yet. `packages/sdk/test/plugin-validate.test.ts` gained the `usage` row so the boundary check is exercised by the new `PORT_MEMBERS` entry.
