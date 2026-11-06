---
title: Stop and restart ask the manager
status: done
depends:
  - task-01-a-supervised-daemon-writes-its-record.md
layer: server
refs:
  - "[code://packages/server/src/daemon.ts#L716-L740](../../../../packages/server/src/daemon.ts#L716-L740) - `stop`, a signal to the recorded pid"
  - "[code://packages/server/src/commands/restart.ts#L490-L493](../../../../packages/server/src/commands/restart.ts#L490-L493) - `restartAtTerminal`"
  - "[code://packages/server/src/commands/restart.ts#L1-L11](../../../../packages/server/src/commands/restart.ts#L1-L11) - the served restart, which starts its own successor"
---

## Objective

When the record names a service, `ahpd stop` and `ahpd restart` ask the service manager, and the daemon spawns no successor of its own.

## Files

- `CREATE: packages/server/src/service.ts` - the calls to `systemctl --user` and `launchctl`, behind one interface that a test can replace.
- `UPDATE: packages/server/src/daemon.ts:716-740` - `stop` calls the manager for a record with `service`.
- `UPDATE: packages/server/src/commands/restart.ts:490-493` - a restart at the terminal calls the manager for a record with `service`.
- `UPDATE: packages/server/src/commands/restart.ts` - a served restart of a supervised daemon asks the manager and does not call `start`.
- `UPDATE: packages/server/test/daemon.test.ts` - the stop cases.
- `UPDATE: packages/server/test/server-cli-restart.test.ts` - the restart cases.

## Steps

1. Write the tests first, with a fake manager.
2. Write `service.ts` with `stop(service)` and `restart(service)` for `systemd` and `launchd`.
3. In `stop`, call the manager for a record with `service`, then wait for the pid to go as now.
4. In `restartAtTerminal`, call the manager for a record with `service`, then wait for a new record.
5. Keep the check on a running turn, which refuses a restart without `--force`.
6. In the served restart, call the manager for a supervised daemon instead of `start`.
7. Set this task and the plan row to `implemented`.

## Validation

- A test: `stop` on a supervised record calls the fake manager's `stop`, and sends no signal.
- A test: `restart` on a supervised record calls the fake manager's `restart`, and starts no process.
- A test: `restart` without `--force` still refuses while a turn runs.
- A test: a record without `service` stops and restarts as now.
- `pnpm -s build`, `pnpm -s typecheck` and the server vitest suite pass.

## Resume

Done 2026-10-16. Every step is built, and every case the Validation names passes. Not reviewed.

`packages/server/src/service.ts` is new.
It holds `Service`, the unit name, the launch label, `managerCall`, the `Run` seam, `realManager` and the `Manager` interface.
A command that exits non-zero is refused with its first output line, or with its exit code.
A command that is not on the machine is refused with the start failure.

`stop` in `daemon.ts` reads the record first.
When the record names a service, it asks the manager and waits for the pid to go with `goneWithin`.
It never signals or kills, because a SIGKILL under `Restart=on-failure` is a crash the unit restarts.
A process still alive after the manager answered is reported in words.
`StopSteps` gained a required `manager`.

`restart.ts` gained `AtTerminal.manager` and `restartedUnderService`.
It asks the manager and waits, up to `timeoutMs`, for a record with a new pid.
It waits on the record, not the log, because the manager starts the successor.
`notRestartable` answers nothing for a supervised record before the line check.
The turn in flight is still refused without `--force`, in `checkedRestart`.

`restartUnderManager` is the daemon's own restart of a supervised daemon.
It goes down, forgets the record, asks the manager, prints one line and exits 0.
The exit is clean on purpose: a unit restarts only failures.
It exits 1 with the reason when the way down or the manager failed.
The record goes first, because the next daemon refuses to run beside a record of a live daemon.
`LifecycleSteps.hand` selects it, and `run.ts` sets it only for a daemon that `AHPD_SERVICE` names.

Files: `packages/server/src/service.ts`, `packages/server/src/daemon.ts`, `packages/server/src/commands/restart.ts`, `packages/server/src/commands/run.ts`, `packages/server/test/service.test.ts`, `packages/server/test/daemon.test.ts`, `packages/server/test/server-restart.test.ts`, `packages/server/test/control.test.ts`, `packages/server/test/server-cli-restart.test.ts`, `packages/server/test/cli.ts`, `packages/server/test/fixtures/systemctl-fake/systemctl`.

Departures from this file:

- `run.ts` is not in the Files list. It wires `hand` and a `read` that answers `undefined` for a supervised daemon.
- Without that wiring, a served restart starts a successor inside the unit's own cgroup, which is the risk the plan names.
- `service.test.ts` is new. It drives `realManager` through the `Run` seam, because the fake manager never sees the real commands.
- The fake-manager cases are in `server-restart.test.ts` and `daemon.test.ts`, where step objects allow a fake manager.
- `cli.ts` gained `supervised()`, `fakeSystemctl()` and `systemctlAsked()`.
- The `systemctl` fixture is copied into the case directory and made executable there, because git keeps the committed mode.
- `AtTerminal` gained a required `manager`. Every existing fake gained a `noManager` that throws.
- `LifecycleSteps.hand` is optional, so existing `LifecycleSteps` compile unchanged.

Validation: `pnpm -s build`, `pnpm -s typecheck`, `pnpm -s boundary` and `node tools/schema.mjs` pass.
`git diff --quiet tools/` is clean afterwards.
`packages/server` vitest: 56 files and 1139 tests pass.
The new cases are 2 stop, 2 `restartAtTerminal`, 2 `lifecycle`, 2 `POST /api/restart`, 7 in `service.test.ts` and 2 in `server-cli-restart.test.ts`.

Left: nothing. Only a test sets `AHPD_SERVICE` until tasks 03 and 04.
