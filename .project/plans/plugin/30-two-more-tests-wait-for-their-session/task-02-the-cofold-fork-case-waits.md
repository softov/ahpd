---
title: The cofold fork case waits for its records
status: implemented
depends: []
layer: "tests"
refs:
  - "[code://packages/agent-cofold/test/agent-cofold-fork.test.ts](../../../../packages/agent-cofold/test/agent-cofold-fork.test.ts) - `copies the kept turns with their records, not just their text`"
---

## Objective

`copies the kept turns with their records, not just their text` no longer fails with `expected [] to deeply equal [ 'completed' ]`: it waits on what its session is still doing, with a wall-clock limit that fails on its own message.

## Steps

1. Reproduce under load (several copies of the file at once, pinned to 2 CPUs) and record the rate; find the writer.
2. Wait on the writer's own completion. No retries, no timeout changes. If the writer is product code with nothing to wait on, stop and report.
3. The rate after, under the same load.

## Validation

- 0 failures under load; `pnpm typecheck`, `pnpm boundary`, full `pnpm test` 3 times.

## Resume

Implemented 2026-09-29, test-only, in `packages/agent-cofold/test/agent-cofold-fork.test.ts`.
The writer is `Store.sessions.fork` in `@cofold/store-file`, run by the forked session's opening (`cut` in `packages/agent-cofold/src/session.ts`): it writes the target's `messages.jsonl` first and then, per kept run, `run.json`, `events.jsonl` and `steps.jsonl`. The case waited only for the three messages and then read the runs, so it could read them before the fork had written them. A probe right after that wait found the target with no run in 29 of 40 file runs and a run with no events in 10 more; only 1 in 40 saw the fork whole. The fork is bounded and its completion shows in the store, so there is no product fault.
A helper, `landed`, waits with a 2 s wall-clock limit that throws its own message until the target has its messages and every source run that ended inside them has as many events and steps in the target as in the source; it replaces the message-count wait. No removal retries, no timeout changes; the temporary probe is removed.
Rates before, under `taskset -c 0,1` with 1 busy loop, 10 rounds of 4 copies: the assertion did not fail, 0 in 40 file runs, while the probe saw the fork unfinished in 39 of 40. After, the same load: 0 failures in 40 file runs, the probe after the wait saw one run with all 6 events in 40 of 40, and the helper's own message never fired.
Gates: `pnpm typecheck` 0, `pnpm boundary` 0, full `pnpm test` 3 times, exit 0 each (121 files, 1719 tests).
