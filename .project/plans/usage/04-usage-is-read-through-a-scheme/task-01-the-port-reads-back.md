---
title: The usage port names its pools and reads a pool's records back
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/usage.ts#L107-L126](../../../../packages/sdk/src/types/usage.ts#L107-L126) - the `Usage` port, where `pools` and `records` join `record` and `total`"
  - "[code://packages/sdk/src/usage.ts#L44-L66](../../../../packages/sdk/src/usage.ts#L44-L66) - the store's own account of what it keeps and what a shared store would answer"
  - "[code://packages/sdk/src/usage.ts#L147-L177](../../../../packages/sdk/src/usage.ts#L147-L177) - `load`, the one read of every month's file, and the shapes it skips"
  - "[code://packages/sdk/src/usage.ts#L198-L224](../../../../packages/sdk/src/usage.ts#L198-L224) - `total`, which compares a range at the day"
---

## Objective

`Usage` gains `pools()` and `records(pool, from, until)`, so a client can be told which pools exist and shown the records behind a pool's total, and `fileUsage` answers both from the monthly files it already writes.

## Files

- `UPDATE: packages/sdk/src/types/usage.ts:107-126` - `pools()` and `records(pool, from, until)` on the port, each with the doc comment that says what an empty answer means.
- `UPDATE: packages/sdk/src/usage.ts:44-66` - the store's doc, which says a shared store answers "the same two calls".
- `UPDATE: packages/sdk/src/usage.ts:179-225` - `fileUsage`'s answer, beside `total`.
- `UPDATE: packages/sdk/test/usage.test.ts` - the cases below.
- `UPDATE: packages/server/test/fixtures/plugin-usage/index.ts:22-25` - the store a plugin contributes, which has to answer the two new calls to be a `Usage`.

## Steps

1. `pools()` is here because `usage:///` has to list the pools a reader may see, and every other call on the port is asked about one named pool, so the store is the only place that can answer which pools exist: a pool may name a person who has been taken out of the users file, or `root:<host>`, and neither is anywhere else.
2. `pools()` answers every distinct pool any line names, sorted, without a repeat, and `[]` for a folder with no usage files in it.
3. It reads the same files `load` reads at `packages/sdk/src/usage.ts:147-177`, matching the same `FILE` at `:28` and skipping a torn or nameless line the same way `load` does, rather than a second reading of the folder with a different idea of what a line is.
4. `records(pool, from, until)` answers the records charged to that pool, newest first: the months the range covers, most recent month first, and each month's lines reversed.
5. A record is in the answer when it names the pool, which is what `charge` at `:110-123` charges, so a record charged to two pools appears under both and one charged to none appears under neither.
6. The range is compared at the day, the way `total` compares it at `:198-224`, so the records behind a period's total are exactly the records that total summed and the plan's checklist line holds. An open question below says what an answer is when a bound is left out.
7. Neither call goes through the `serialise` queue at `:126-131`: they read what is on disk, and a line is appended whole because `record` appends with one `appendFileSync`.
8. Rewrite the store's doc at `:44-66` and the comment at `:189-195`, which both count the calls a shared store answers.

## Validation

- `packages/sdk/test/usage.test.ts`: a folder holding both kinds across two months names every pool sorted and once; a folder with no usage files answers `[]`; records for one pool come back newest first across a month boundary; a pool nothing was charged to answers `[]`; a range covering part of a day takes the whole day, as `total` does, so the day's records sum to the day's total; one record charged to two pools is under both; a torn line is skipped and reported and the month's other records are still answered.
- `packages/server/test/fixtures/plugin-usage/index.ts`: the fixture answers `pools` and `records`, because a store that answers two of four is not a `Usage` and `pnpm typecheck` says so.
- `pnpm exec vitest run packages/sdk/test/usage.test.ts packages/server/test/usage-port.test.ts`.
- `pnpm typecheck`, `pnpm test`, `pnpm boundary`.

## Resume
