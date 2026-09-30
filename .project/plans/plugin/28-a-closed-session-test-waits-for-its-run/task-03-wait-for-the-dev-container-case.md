---
title: The dev container cases wait for what they started before removing their folder
status: done
depends: []
layer: "computer tests"
refs:
  - "[code://packages/computer/test/computer-devcontainer.test.ts#L34-L44](../../../../packages/computer/test/computer-devcontainer.test.ts#L34-L44) - `afterEach` removes the folder `temp` made"
---

## Objective

`offers the session folder's dev container, and not once one exists`, and any other case in `computer-devcontainer.test.ts` that leaves something writing into its temporary folder, waits for that writer to finish before `afterEach` removes the folder. The wait has a wall-clock limit that fails on its own message.

## Steps

1. Reproduce `ENOTEMPTY` (1 run in 12 of the file alone on main, 2026-09-29), and find what writes into the folder after the case's last assertion: a fixture's state file, the plugin, or the host.
2. Wait on that writer's own completion in the case; record the rate before and after under load.
3. If the writer is product code that goes on after the session is done with nothing to wait on, stop and report it.

## Validation

- 0 failures under load; `pnpm typecheck`, `pnpm boundary`, full `pnpm test` 3 times.

## Resume

Implemented 2026-09-29, test-only, in `packages/computer/test/computer-devcontainer.test.ts`.
The writer is the scripted `docker` fixture, run by the plugin's startup listing: loading the plugin calls `made.list()` without awaiting it (`packages/computer/src/plugin.ts`, the listing that re-arms disposable machines left behind), so a `docker ps` can still be starting, taking `<state>.lock`, writing `<state>.<pid>.tmp` and renaming it over the state file after the case's last assertion. A probe caught it: the failing case's second load left `docker-existing.json` with one `ps` recorded of two and `docker-existing.json.lock` held. It is bounded, one process per load, and its completion shows in the fixture's own state, so there is no product fault.
A helper, `answered`, waits with a 4 s wall-clock limit that throws its own message until the state file records the case's number of calls and no lock is held; the lock is the last thing a call lets go of, on its exit. Every case loads the plugin and so has the same unawaited listing, and all six call it before `afterEach` (counts: 6; 1 and 3; 6; 3 and 2; 2; 3). No fixture change, no removal retries, no timeout changes; the temporary probe is removed.
Rates before: `ENOTEMPTY` in 1 of 24 runs of the file alone, and 1 of 80 with 4 copies at once unpinned, always the dev container case; 0 of 120 under `taskset -c 0,1` with 2 busy loops (15 rounds of 8), where the load slows every call alike; 16 copies there time out at 5 s in every file before and are no measure. The probe found the listing unfinished at the case's end in 1 of 6 runs alone. After: 0 failures in 160 runs with 4 at a time unpinned (40 rounds) and 0 in 80 under `taskset -c 0,1` with 2 busy loops (10 rounds of 8); the helper's own message never fired.
Gates: `pnpm typecheck` 0, `pnpm boundary` 0, full `pnpm test` 3 times, exit 0 each (120 files, 1713 tests).
