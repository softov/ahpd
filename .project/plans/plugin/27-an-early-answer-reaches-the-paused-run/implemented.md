---
title: "An answer given the moment a cofold request opens reaches the run - implemented"
date: 2026-09-28
refs:
  - git://518f438
  - "[code://packages/agent-cofold/src/session.ts](../../../../packages/agent-cofold/src/session.ts) - `pausing`, `route` and `stopNow`"
---

A client that answers or cancels a cofold approval the moment it appears now reaches the run, and the turn ends.
Before, an answer landing between cofold's `approval.requested` and its awaiting `run.finished` was lost and the turn never ended.

## What was built

- [`code://packages/agent-cofold/src/session.ts`](../../../../packages/agent-cofold/src/session.ts) - `pausing`, the pause a live run owes once it has announced a request, settled by its `run.finished`; `route` and `stopNow` wait on it while `paused` is unset, then go through `rejoin`; a run that ends otherwise drops what was held.

## Verified

- [`code://packages/agent-cofold/test/agent-cofold-tools.test.ts`](../../../../packages/agent-cofold/test/agent-cofold-tools.test.ts) - three new cases answer inside the `session/inputNeededSet` emit (approve, decline, cancel); the fixed `settle` before an answer is gone. All six answer and cancel cases failed on the old code.
- Load (6 copies, 2 CPUs, 2 busy loops): those cases failed 12 of 12 runs before, 0 of 24 after.
- `pnpm typecheck`, `pnpm boundary` clean; full `pnpm test` 1713 of 1713 three times at `bde31b5`, each exit 0.

## Departures from the plan

- The request is held in `pending` just before its `session/inputNeededSet` is emitted rather than after the batch, so an answer given inside the emit finds it.

## Left for later

- none.
