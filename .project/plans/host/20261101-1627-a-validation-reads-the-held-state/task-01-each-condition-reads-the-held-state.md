---
title: Each condition reads the held state
status: todo
depends: []
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - each client action's checks and its hand-over to the backend"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - the dispatch being applied, which says whether anything answered it"
  - "[code://packages/sdk/src/host/spawn.ts](../../../../packages/sdk/src/host/spawn.ts) - `Start.handed`, which marks a dispatch a backend answers later"
---

## Objective

A cancel, a resume, a removal, a draft, a confirmation, an input action and a truncation are checked against the chat's held state.
An accepted action that no backend says back or takes is said back by the host.

## Files

- `UPDATE: packages/sdk/src/host/state.ts:136-145` - `Dispatched.taken`, set when a backend takes a dispatch to answer later.
- `UPDATE: packages/sdk/src/host/context.ts:349` - `unanswered`, whether the dispatch being applied still has no answer.
- `UPDATE: packages/sdk/src/host.ts:1314-1315` - `unanswered` reads the dispatch being applied.
- `UPDATE: packages/sdk/src/host/spawn.ts:1174-1192` - `Start.handed` marks the dispatch it hands out as taken.
- `UPDATE: packages/sdk/src/host/chatactions.ts:1139-1217` - a resume and a cancel read the held chat state.
- `UPDATE: packages/sdk/src/host/chatactions.ts:1491-1593` - a draft, a removal, a confirmation and an answer read it.
- `UPDATE: packages/sdk/src/host/chatactions.ts:1685` - a truncation names a completed turn of the held state.
- `UPDATE: packages/sdk/src/host/chatactions.ts:1765-1780` - a draft answer reads it.

## Steps

1. Add `taken` to `Dispatched`, and set it in `Start.handed`.
2. Add `unanswered` to the host context, which reads the dispatch the host applies.
3. Read the chat's held state once in `applyDispatch`, for a worker's own chat or the chat its backend serves.
4. Check a cancel's turn against the held active turn, and say the end when the backend runs no such turn.
5. Refuse a resume while a turn runs, and check the latest errored turn against the held state.
6. Check a removal, a draft, a confirmation and both input actions against the held state.
7. After each hand-over, say the client's action when `unanswered` is still true.
8. Refuse a steering removal during a turn when the backend takes nothing back, in the reference's words.
9. Check a truncation's turn against the held state, and the backend's record of it after.

## Validation

- `pnpm exec vitest run packages/sdk/test/ahp-test-cases.test.ts` passes with the stale entries for 015 and 224 removed.
- The full unit run at two workers passes, each failure under load rerun alone.

## Resume

<Empty until started.>
