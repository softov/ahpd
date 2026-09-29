---
title: Wait for the run before removing the store
status: implemented
depends: []
layer: "agent-cofold tests"
refs:
  - "[code://packages/agent-cofold/test/agent-cofold-tools.test.ts](../../../../packages/agent-cofold/test/agent-cofold-tools.test.ts) - the three close-then-remove places"
  - "[code://packages/agent-cofold/test/agent-cofold-store.test.ts](../../../../packages/agent-cofold/test/agent-cofold-store.test.ts) - `pausedRun`, a store wait to copy"
---

## Objective

A helper waits until the store has no run of the session still `running` or `awaiting`, failing on its own message after a wall-clock limit inside the case's own; the three places call it after `close` and before `rmSync`.

## Steps

1. Reproduce `ENOTEMPTY` first under load (several copies of the file at once, pinned to 2 CPUs), and record the rate.
2. Add the helper and use it; confirm the run ends `cancelled` rather than staying `awaiting`.
3. Load rate after.

## Validation

- 0 failures under load; `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

Implemented 2026-09-29, test-only, in `packages/agent-cofold/test/agent-cofold-tools.test.ts`.
A helper, `settled`, opens `createFileStore` on the case's store and waits, with a 4 s wall-clock limit that throws its own message inside the case's, until the session has a run and none is `running` or `awaiting` or has a write after its `run.finished`; it answers the statuses. The three places (the declined-edit case, the shell-command case and `outcomeOf`) call it after `close` and before `rmSync`, and assert `['cancelled']`: every closed run ends `cancelled`, none stays `awaiting`, so there is no product fault.
The wait also reads the run's last event because cofold's `finishRun` writes the status, releases the writer, then appends `run.finished` to `runs/<id>/events.jsonl`; a wait on status alone would still race that last append.
Reproduction under load (copies of the file at once under `taskset -c 0,1` with two busy loops): `ENOTEMPTY` did not reproduce locally, 0 in 251 file runs. The same race showed as stores rebuilt after their removal (cofold's `mkdir -p` recreating `workspaces/.../sessions/tools/runs/<id>` with `run.json` and `events.jsonl`, most left `awaiting` because the rejoin found no store): 157 in those 251 file runs before, 0 in 160 file runs (20 rounds of 8) after. No removal retries, no timeout changes.
Gates: `pnpm typecheck` 0, `pnpm boundary` 0, full `pnpm test` 3 times, exit 0 each (120 files, 1713 tests).
