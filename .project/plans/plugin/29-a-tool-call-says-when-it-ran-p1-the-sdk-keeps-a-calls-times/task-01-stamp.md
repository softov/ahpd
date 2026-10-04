---
title: The sdk has one helper that builds and keeps a tool call's timing _meta
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L2214-L2250](../../../../packages/sdk/src/host.ts#L2214-L2250) - `unstamped`, `withWorkerUri` and `stampedCalls`, the pattern for a `_meta` key kept across actions"
  - "[code://packages/sdk/src/paging.ts](../../../../packages/sdk/src/paging.ts) - a small sdk module a plugin imports"
  - "[code://packages/sdk/src/index.ts#L76-L77](../../../../packages/sdk/src/index.ts#L76-L77) - where such a module is exported"
---

## Objective

A helper in the sdk builds `{ 'ahpd.startedAt', 'ahpd.endedAt', 'ahpd.durationMs' }` from a start and an end and merges it into a call's `_meta` beside the keys already there, so a plugin that resends `_meta` keeps both `toolKind` and the times.

## Files

- `CREATE: packages/sdk/src/timing.ts` - `callTimes`, `withCallTimes` and `startOf`.
- `UPDATE: packages/sdk/src/index.ts:76-77` - export the three beside `tail`, `older` and `PAGE`.
- `CREATE: packages/sdk/test/timing.test.ts` - the cases below.

## Steps

1. Failing first: the cases under Validation.
2. `callTimes(start: number | string, end?: number | string, durationMs?: number): Bag` answers `{ 'ahpd.startedAt': <ISO> }`, plus `'ahpd.endedAt': <ISO>` and `'ahpd.durationMs'` when an end is given; `durationMs` is the one given, else the end minus the start in milliseconds, never below 0.
3. `withCallTimes(meta: Bag | undefined, times: Bag): Bag` answers `{ ...meta, ...times }`, so `toolKind` and the reference's `subagent*` keys stay.
4. `startOf(meta: unknown): number | undefined` reads `ahpd.startedAt` back as epoch milliseconds, so a plugin that kept the start only on the held call can time the end.
5. The keys are spelled once, in this module, and every plugin goes through it.

## Validation

- `packages/sdk/test/timing.test.ts`: merging keeps `toolKind` and the times; `ahpd.durationMs` is the difference in ms; a given `durationMs` wins; a missing end gives only `ahpd.startedAt`; an ISO and an epoch start give the same ISO; `startOf` reads back what `callTimes` wrote; no bare `startedAt`, `endedAt` or `durationMs` key is ever written.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume
