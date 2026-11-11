---
title: A restart exits for the restart policy
status: done
depends: [task-01-a-container-daemon-writes-its-record.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/restart.ts#L235-L270](../../../../packages/server/src/commands/restart.ts#L235-L270) - `restartUnderManager`, the path a container restart runs"
  - "[code://packages/server/src/commands/restart.ts#L679-L722](../../../../packages/server/src/commands/restart.ts#L679-L722) - `restartedUnderService`, the terminal restart of a held daemon"
  - "[code://packages/server/src/commands/run.ts#L2402-L2414](../../../../packages/server/src/commands/run.ts#L2402-L2414) - `hand`, set only for a held daemon"
  - "[code://packages/server/src/commands/run.ts#L2466-L2477](../../../../packages/server/src/commands/run.ts#L2466-L2477) - the restart signals, heard only when detached"
---

## Objective

A restart of a container daemon closes it, drops its record and exits with 75, so the restart policy starts it again.
The restart works from a client and from `docker exec <container> ahpd restart`.

## Files

- `UPDATE: packages/server/src/commands/restart.ts:235-270` - `restartUnderManager` takes the exit code of a handed restart; the container kind passes 75.
- `UPDATE: packages/server/src/commands/restart.ts:679-722` - a `container` record is restarted by the restart signal to its pid, in place of the `FOREGROUND` refusal of task 01.
- `UPDATE: packages/server/src/commands/run.ts:2402-2414` - a container daemon gets a `hand` that asks nothing.
- `UPDATE: packages/server/src/commands/run.ts:2466-2477` - a container daemon listens for `RESTART_SIGNAL` and `FORCED_SIGNAL` as a detached one does.
- `UPDATE: packages/server/test/server-restart.test.ts` - the served restart of a container daemon.
- `UPDATE: packages/server/test/server-cli-restart.test.ts` - the terminal restart of a container record.

## Steps

1. Add the exit code 75 as a named constant beside `HANDED`.
2. Give `restartUnderManager` the exit code it uses after `hand` resolves.
3. Set `hand` in `run.ts` for `container` to a step that resolves at once.
4. Make the container daemon listen for the restart signals in `run.ts`.
5. Send `RESTART_SIGNAL` to the recorded pid when the record names `container`, and `FORCED_SIGNAL` with `--force`.
6. Remove the `FOREGROUND` refusal that task 01 put on a `container` record.
7. Add the tests for each path.

## Validation

- `packages/server/test/server-restart.test.ts`: a served restart of a container daemon closes, drops the record, and exits with 75.
- `packages/server/test/server-restart.test.ts`: a restart that fails to close still exits 1.
- `packages/server/test/server-cli-restart.test.ts`: a terminal restart of a `container` record sends `SIGHUP`, and `--force` sends `SIGUSR2`.
- `pnpm test` passes.

## Resume

- `CONTAINER_EXIT` is 75, beside `HANDED`; `restartUnderManager` takes the code it exits with once the hand resolves.
- `LifecycleSteps.handExit` carries that code, and `run.ts` sets it for a container.
- A container daemon's `hand` asks nothing and resolves at once, so the served restart closes, drops the record and exits 75.
- A container daemon listens for `RESTART_SIGNAL` and `FORCED_SIGNAL` even when it is not detached.
- A terminal restart of a container record sends the signal and answers `{ container: pid }` at once, with no manager and no wait: the container runtime starts the next daemon, and the terminal prints `Asked the container daemon (pid N) to restart; the container starts it again when it exits.`
- Validation passed: `server-restart.test.ts` 72 passed, `server-cli-restart.test.ts` 17 passed, typecheck clean.
- The full suite passed except the two environmental `host-permissions` edit-approval cases and one load flake in `server-cli-restart.test.ts`, which passes alone.
