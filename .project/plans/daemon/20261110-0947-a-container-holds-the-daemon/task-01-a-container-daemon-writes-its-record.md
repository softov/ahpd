---
title: A container daemon writes its record and refuses a stop
status: done
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/daemon.ts#L155-L176](../../../../packages/server/src/daemon.ts#L155-L176) - `serviceIn`, which learns `container`"
  - "[code://packages/server/src/daemon.ts#L98-L109](../../../../packages/server/src/daemon.ts#L98-L109) - the record's `service` field"
  - "[code://packages/server/src/daemon.ts#L879-L903](../../../../packages/server/src/daemon.ts#L879-L903) - `stop` and `stoppedUnderService`, which take `Service`"
  - "[code://packages/server/src/service.ts#L26-L31](../../../../packages/server/src/service.ts#L26-L31) - `Service`, which the unit and plist writers take"
  - "[code://packages/server/src/commands/restart.ts#L679-L722](../../../../packages/server/src/commands/restart.ts#L679-L722) - `restartedUnderService`, which takes `Service`"
---

## Objective

A daemon started with `AHPD_SERVICE=container` writes its own record with `service: container`.
`ahpd status` and `ahpd doctor` read that record as they read a systemd one.
`ahpd stop` and a client's shutdown refuse it, because the restart policy would start it again.

## Files

- `UPDATE: packages/server/src/service.ts:26-31` - add a held kind that is `Service` or `container`; `Service` stays the two installable managers.
- `UPDATE: packages/server/src/daemon.ts:98-109` - the record's `service` field takes the held kind, with `container` in its comment.
- `UPDATE: packages/server/src/daemon.ts:155-176` - `serviceIn` reads `container`, and the comment names it.
- `UPDATE: packages/server/src/daemon.ts:879-903` - `stop` refuses a `container` record before it reaches `stoppedUnderService`.
- `UPDATE: packages/server/src/commands/restart.ts:714-722` - a `container` record refuses a restart with `FOREGROUND` until task 02 replaces it.
- `UPDATE: packages/server/test/daemon.test.ts` - `serviceIn('container')`, the record it writes, and the stop refusal.
- `UPDATE: packages/server/test/server-cli-restart.test.ts` - `ahpd stop` on a `container` record sends no signal.

## Steps

1. Add the held kind to `service.ts`, beside `Service`.
2. Change the record's `service` field to the held kind.
3. Make `serviceIn` return `container` for that value.
4. Keep every install, uninstall and manager call typed on `Service`, so `container` never reaches `systemctl` or `launchctl`.
5. Add one exported sentence for the stop refusal: `This daemon runs in a container; stop the container instead.`
6. Refuse `stop` for a `container` record before `stop` sends any signal.
7. Refuse a served shutdown of a container daemon with the same sentence.
8. Narrow the restart call site so a `container` record refuses with `FOREGROUND` for now.
9. Add the tests for each path.

## Validation

- `packages/server/test/daemon.test.ts`: `serviceIn` reads `container`, and an unknown value is still no manager.
- `packages/server/test/daemon.test.ts`: a record written under `container` carries `service: container` and no `serviceName`.
- `packages/server/test/server-cli-restart.test.ts`: `ahpd stop` on a `container` record refuses and sends no signal.
- `pnpm typecheck` passes, with no `container` value in a call to `managerCall` or `installCalls`.
- By hand: `AHPD_SERVICE=container ahpd run` in one shell, and `ahpd status --json` in another prints `"service":"container"` and exits 0.

## Resume

- `Held` in `service.ts` is `Service` or `container`; `Service` stays the two installable managers.
- A record's `service` field and `serviceIn` take `container`; a container record carries no `serviceName`.
- `stop` refuses a container record before any signal, with `CONTAINER_STOP`.
- A served shutdown of a container daemon refuses with the same sentence.
- A terminal restart of a container record refuses with `FOREGROUND` until task 02.
- Validation passed: `daemon.test.ts` 69 passed and 1 skipped, `server-cli-restart.test.ts` 15 passed, typecheck clean.
