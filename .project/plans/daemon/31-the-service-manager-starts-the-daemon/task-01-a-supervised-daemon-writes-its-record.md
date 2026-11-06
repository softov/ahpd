---
title: A supervised daemon writes its record
status: done
depends: []
layer: server
refs:
  - "[code://packages/server/src/commands/run.ts#L197-L212](../../../../packages/server/src/commands/run.ts#L197-L212) - where `AHPD_DETACHED` is read and removed"
  - "[code://packages/server/src/daemon.ts#L281-L312](../../../../packages/server/src/daemon.ts#L281-L312) - `recordOf`, which builds a record from the announcement"
  - "[code://packages/server/src/daemon.ts#L542-L554](../../../../packages/server/src/daemon.ts#L542-L554) - `claim`, which refuses a second live daemon"
  - "[code://packages/server/src/commands/status.ts#L28-L34](../../../../packages/server/src/commands/status.ts#L28-L34) - `status`, which reads the record"
---

## Objective

A daemon that a service manager starts writes its own `daemon.json`, with a `service` field that names the manager.
`ahpd status` then describes it as it describes a daemon from `ahpd start`.

## Files

- `UPDATE: packages/server/src/daemon.ts:30-82` - `Running` gets `service?: 'systemd' | 'launchd'`.
- `UPDATE: packages/server/src/daemon.ts:281-312` - `recordOf` takes the service name.
- `UPDATE: packages/server/src/commands/run.ts:197-212` - read and remove `AHPD_SERVICE`, and claim the record once the daemon announces itself.
- `UPDATE: packages/server/src/commands/status.ts:35-54` - the plain line and the JSON name the service.
- `UPDATE: packages/server/test/daemon.test.ts` - the cases in Validation.

## Steps

1. Write the tests first.
2. Add `SERVICE_ENV = 'AHPD_SERVICE'` beside `DETACHED_ENV` in `daemon.ts`.
3. Read `AHPD_SERVICE` in `runForeground`, and remove it from `process.env` at once.
4. After the announcement, build the record with `recordOf` and the service name, and write it with `claim`.
5. Stop with a conflict when `claim` answers another live daemon.
6. Remove the record on the way down, as `forget` does for a detached daemon.
7. Add the service to the `status` line and to its JSON.
8. Set this task and the plan row to `implemented`.

## Validation

- A test: a run with `AHPD_SERVICE=systemd` writes a record with `service: 'systemd'` and its own pid.
- A test: a session shell does not inherit `AHPD_SERVICE`.
- A test: a second supervised run with a live record stops with a conflict.
- A test: `status --json` holds the `service` field and no token.
- `pnpm -s build`, `pnpm -s typecheck`, `pnpm boundary` and the server vitest suite pass.

## Resume

Done 2026-10-16. Every step is built, and every case the Validation names passes. Not reviewed.

`daemon.ts` has `SERVICE_ENV = 'AHPD_SERVICE'` and `serviceIn`.
`serviceIn` reads `systemd` or `launchd` and answers nothing for any other value.
`Running` gained `service?: 'systemd' | 'launchd'`.
`recordOf` takes it as a sixth argument and writes it only when it is set.
`statusLine` ends with `, under systemd` for a record that names a service.

`runForeground` reads `AHPD_SERVICE` beside `AHPD_DETACHED` and `AHPD_CONTROL`, and deletes it at once.
A supervised daemon claims the record right after it says its announcement.
It passes `undefined` for the line and the control, because a restart goes to the manager (task 02).
A record held by another live daemon is answered with `stamp` and `process.exit(1)`.
A thrown `CofoldError` would leave the listeners open.

The record is removed on the way down with no new code: `lifecycle` already calls `steps.forget`.

Files: `packages/server/src/daemon.ts`, `packages/server/src/commands/run.ts`, `packages/server/src/commands/status.ts`, `packages/server/src/commands/served.ts`, `packages/server/test/daemon.test.ts`, `packages/server/test/fixtures/plugin-env/index.ts`.

Departures from this file:

- `served.ts` gained the `service` field on `ServedRunning`, and `run.ts` fills it in. `status.ts` does not compile over both records without it.
- `status.ts` writes the field into its JSON only. The plain line is `statusLine` in `daemon.ts`.
- The `plugin-env` fixture now reads `AHPD_SERVICE` beside `AHPD_DETACHED`.
- The conflict is a stamp and an exit, not a thrown `CofoldError`.

Validation: `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass.
`packages/server` vitest: 55 files and 1121 tests pass.
There are four new cases in `daemon.test.ts`.

Left: nothing. Only a test sets `AHPD_SERVICE` until tasks 03 and 04.
