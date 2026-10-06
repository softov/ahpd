---
title: A restart takes no new turn once it has checked
status: todo
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/commands/restart.ts#L231-L246](../../../../packages/server/src/commands/restart.ts#L231-L246) - `checkedRestart`, the turn check"
  - "[code://packages/server/src/commands/run.ts#L895-L912](../../../../packages/server/src/commands/run.ts#L895-L912) - `down`: plugins' `stopping` is awaited, unbounded, before the listeners close"
  - "[code://packages/server/test/server-restart.test.ts](../../../../packages/server/test/server-restart.test.ts) - the restart cases"
---

## Objective

Between an unforced restart's turn check and the host closing, no new turn starts; a client that tries is told the daemon is restarting, so an unforced restart never ends a turn.

## Files

- `UPDATE: packages/server/src/commands/restart.ts:231-246` - the host stops taking turns before the check.
- `UPDATE: packages/sdk/src/host` - whatever lets the daemon tell the host to refuse new turns (find where a turn starts; a refusal with a clear message).
- `UPDATE: packages/server/test/server-restart.test.ts` - the case below.

## Steps

1. Failing case first: a plugin whose `stopping` handler waits on a promise the test controls; request a restart with no turn running, start a turn while `stopping` waits, release it; today the turn is ended by `host.close()`.
2. Before the turn check, put the host into a state that refuses a new turn with "The daemon is restarting". Then check; if a turn is running and the restart is not forced, leave that state and refuse the restart as today.
3. A forced restart takes the same state, so nothing new starts while it closes.

## Validation

- The case fails on `main` and passes after; the existing restart cases still pass.
- `pnpm exec vitest run packages/server/test/server-restart.test.ts packages/server/test/server-cli.test.ts`.

## Resume
