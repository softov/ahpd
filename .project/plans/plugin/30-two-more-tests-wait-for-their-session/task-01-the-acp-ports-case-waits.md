---
title: The acp ports case waits for its shell
status: done
depends: []
layer: "tests"
refs:
  - "[code://packages/agent-acp/test/agent-acp-ports.test.ts](../../../../packages/agent-acp/test/agent-acp-ports.test.ts) - `opens a shell the host owns...`"
---

## Objective

`opens a shell the host owns...` no longer fails with `ENOTEMPTY` in `afterEach`: it waits on what its session is still doing, with a wall-clock limit that fails on its own message.

## Steps

1. Reproduce under load (several copies of the file at once, pinned to 2 CPUs) and record the rate; find the writer.
2. Wait on the writer's own completion. No retries, no timeout changes. If the writer is product code with nothing to wait on, stop and report.
3. The rate after, under the same load.

## Validation

- 0 failures under load; `pnpm typecheck`, `pnpm boundary`, full `pnpm test` 3 times.

## Resume

Implemented 2026-09-29, test-only, in `packages/agent-acp/test/agent-acp-ports.test.ts`.
The writer is the host's own catalogue read: `createHost` calls `readStored` on a zero timer without awaiting it (`packages/sdk/src/host.ts`), which lists the catalogue, and the acp backend's `catalogueOf` spawns a fixture server of its own for that listing. That server appends each request it is sent (`initialize`, then `session/list`) to the case's `requests.jsonl`, so a line can land after `afterEach` has started removing the folder. A probe in `afterEach` found the listing unfinished (no `session/list` in the log yet) for 2 of 9 folders with the file alone, and every case in the file has the same unawaited read. It is bounded, one server per host that answers and is closed, and its last write shows in the fixture's own log, so there is no product fault.
A helper, `listed`, waits with a 4 s wall-clock limit that throws its own message until the folder's log names `session/list`, the last request that server is sent and one a session's server never is; `afterEach` calls it for each folder after the disposals and before `rmSync`. No fixture change, no removal retries, no timeout changes; the temporary probe is removed.
Rates before, under `taskset -c 0,1` with 1 busy loop, 10 rounds of 4 copies: `ENOTEMPTY` did not reproduce, 0 in 40 file runs; the probe found the catalogue read unfinished at removal for 107 of 360 folders, spread over all eight cases (10 in the shell case). 8 copies with 2 busy loops time out at 5 s in 38 of 40 file runs and are no measure. After, the same load: 0 failures in 40 file runs, and the helper's own message never fired.
Gates: `pnpm typecheck` 0, `pnpm boundary` 0, full `pnpm test` 3 times, exit 0 each (121 files, 1719 tests).
