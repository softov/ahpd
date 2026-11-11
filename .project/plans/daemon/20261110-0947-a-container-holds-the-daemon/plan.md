---
title: A container holds the daemon
domain: daemon
status: built
priority: medium
created: 2026-11-10
revalidated: 2026-11-10
changes:
  - specs/daemon.md
refs:
  - git://032300137 - the commit of ahpd this plan was revalidated at
  - "[code://packages/server/src/service.ts#L26-L31](../../../../packages/server/src/service.ts#L26-L31) - `Service`, the two managers a record names today"
  - "[code://packages/server/src/service.ts#L423-L469](../../../../packages/server/src/service.ts#L423-L469) - `Manager` and `realManager`, how `stop` and `restart` reach systemd and launchd"
  - "[code://packages/server/src/daemon.ts#L98-L109](../../../../packages/server/src/daemon.ts#L98-L109) - the record's `service` and `serviceName` fields"
  - "[code://packages/server/src/daemon.ts#L155-L176](../../../../packages/server/src/daemon.ts#L155-L176) - `SERVICE_ENV` and `serviceIn`, which read `systemd` and `launchd` only"
  - "[code://packages/server/src/daemon.ts#L879-L903](../../../../packages/server/src/daemon.ts#L879-L903) - `stop` and `stoppedUnderService`, a held daemon stopped through its manager"
  - "[code://packages/server/src/commands/run.ts#L313-L316](../../../../packages/server/src/commands/run.ts#L313-L316) - `runForeground` reads `AHPD_SERVICE` and removes it from the environment"
  - "[code://packages/server/src/commands/run.ts#L2402-L2414](../../../../packages/server/src/commands/run.ts#L2402-L2414) - `hand`, the restart a held daemon gives its manager, and the stop signals"
  - "[code://packages/server/src/commands/run.ts#L2466-L2477](../../../../packages/server/src/commands/run.ts#L2466-L2477) - the restart signals, heard only by a detached daemon"
  - "[code://packages/server/src/commands/restart.ts#L47-L48](../../../../packages/server/src/commands/restart.ts#L47-L48) - `RESTART_SIGNAL` and `FORCED_SIGNAL`"
  - "[code://packages/server/src/commands/restart.ts#L123-L151](../../../../packages/server/src/commands/restart.ts#L123-L151) - `FOREGROUND` and `notRestartable`, the refusal a container daemon gets today"
  - "[code://packages/server/src/commands/restart.ts#L235-L270](../../../../packages/server/src/commands/restart.ts#L235-L270) - `restartUnderManager`: close, drop the record, hand over, exit"
  - "[code://packages/server/src/commands/restart.ts#L679-L722](../../../../packages/server/src/commands/restart.ts#L679-L722) - `restartedUnderService`, the terminal's restart of a held daemon"
  - "[code://packages/server/src/selfupdate.ts#L61-L69](../../../../packages/server/src/selfupdate.ts#L61-L69) - `refused`, the sentence an update that cannot replace the install says"
  - "[code://packages/server/src/selfupdate.ts#L172-L190](../../../../packages/server/src/selfupdate.ts#L172-L190) - `planUpdate`, where the refusals are decided"
  - "[code://packages/server/src/commands/status.ts#L28-L36](../../../../packages/server/src/commands/status.ts#L28-L36) - `status` exits non-zero with `None running.` when no record is found"
  - "[code://packages/server/test/service.test.ts](../../../../packages/server/test/service.test.ts) - the manager calls, driven without a process"
  - "[code://packages/server/test/server-cli-restart.test.ts](../../../../packages/server/test/server-cli-restart.test.ts) - the terminal restart cases"
  - "[code://packages/server/test/selfupdate-place.test.ts](../../../../packages/server/test/selfupdate-place.test.ts) - the update refusals by install shape"
  - "[code://.project/plans/daemon/31-the-service-manager-starts-the-daemon/plan.md](../31-the-service-manager-starts-the-daemon/plan.md) - the systemd and launchd kinds, the shape this kind copies"
  - https://docs.docker.com/engine/containers/start-containers-automatically/ - restart policies: `on-failure` restarts on a non-zero exit, `unless-stopped` on any exit but `docker stop`
---

## Goal

ahpd can run as the main process of a container, and its lifecycle verbs work there.
A container image sets `AHPD_SERVICE=container`.
The daemon then writes its own record, so `ahpd status`, `ahpd doctor` and a client find it.
A restart closes the daemon and exits, and the container's restart policy starts it again.
`ahpd stop` and `ahpd update` refuse, because the container runtime owns both, and they say what to run instead.
[daemon/20261110-0947-ahpd-runs-from-an-image](../20261110-0947-ahpd-runs-from-an-image/plan.md) builds the image that sets the variable.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "AHPD_SERVICE|serviceIn" packages/server/src` - `serviceIn` reads only `systemd` and `launchd`; any other value is no manager.
- `rg -n "if \(detached\)" packages/server/src/commands/run.ts` - only a detached daemon listens for `SIGHUP` and `SIGUSR2`.
- `rg -n "FOREGROUND" packages/server/src` - a daemon with no record refuses a restart and an update.
- `rg -n "installPlace" packages/server/src/selfupdate.ts` - `/opt/ahpd/lib/node_modules/@ahpd/server` is a valid prefix install, so an image install is not refused by its shape.

### Runtime path

```
AHPD_SERVICE=container -> runForeground -> record with service: container -> status, doctor, client
client restart -> restartUnderManager -> close, drop the record, exit non-zero -> restart policy starts it
docker exec ahpd restart -> record names container -> restart signal to the pid -> the same path
ahpd stop, ahpd update -> record names container -> refused with the container's command
```

### Gaps

- A container daemon writes no record, so every lifecycle verb says no daemon runs.
- A restart in a container would spawn a successor inside the container, which the runtime does not supervise.
- An update in an image would write into `/opt/ahpd`, which the image owns and the next pull replaces.
- `Not found: a manager kind with no command to call - searched Manager, managerCall and installCalls in packages/server/src/service.ts.`

## Answers

| What | Source | Task |
| --- | --- | --- |
| The kind is named `container`, not `docker` | (defaulted: Podman and Kubernetes restart a container the same way) | 01 |
| `service install` and `service uninstall` still offer systemd and launchd only | (defaulted: a container has no unit file to write) | 01 |
| A restart closes the daemon, drops the record and exits with 75 | (defaulted: a non-zero exit restarts under `on-failure`, `unless-stopped` and `always`; 75 is `EX_TEMPFAIL`) | 02 |
| `ahpd restart` at the terminal sends the restart signal to the recorded pid | (defaulted: no manager is reachable from inside the container) | 02 |
| A container daemon listens for the restart signals | (defaulted: the terminal restart has no other way to reach it) | 02 |
| `ahpd stop` and a client's shutdown refuse, and say to stop the container | (defaulted: an exit is restarted by the policy, so a stop from inside is a restart) | 01 |
| `ahpd update` and a client's update refuse, and say to pull the new image | Softov, 2026-11-10, asked for the Docker install where an update names `docker compose pull` | 03 |

## Proposed architecture

- **Data flow** - `runForeground` reads `container` from `AHPD_SERVICE` and writes a record with `service: container`, as it does for systemd.
- **Restart** - the held restart path runs with a `hand` that asks nothing and an exit code of 75.
- **Stop and update** - each refusal is one sentence in one place, reached from the terminal and from a served request.
- **Layer responsibilities** - server: the kind, the record, the refusals and the signals. sdk: nothing.
- **Source-of-truth files** - [`code://packages/server/src/daemon.ts`](../../../../packages/server/src/daemon.ts), [`code://packages/server/src/commands/restart.ts`](../../../../packages/server/src/commands/restart.ts), [`code://packages/server/src/selfupdate.ts`](../../../../packages/server/src/selfupdate.ts).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A container daemon writes its record and refuses a stop](task-01-a-container-daemon-writes-its-record.md) | done | - |
| [02 - A restart exits for the restart policy](task-02-a-restart-exits-for-the-policy.md) | done | 01 |
| [03 - An update names the image](task-03-an-update-names-the-image.md) | done | 01 |

## Risks and tradeoffs

- A container with no restart policy stays down after a restart - The image's docs page says to set one, and the Compose file sets `unless-stopped`.
- `Service` is used by the unit and plist writers - Task 01 keeps `container` out of every install call, with a type that the compiler checks.

## Resume state

- **Done so far:** the plan, 2026-11-10; tasks 01 to 03, 2026-11-10, merged in #282 and #284; reviewed and closed, 2026-11-11.
- **Next action:** none. The plan is built, and [implemented.md](implemented.md) says what exists.
- **Open questions:** none.
- **Watch out for:**
`runForeground` removes `AHPD_SERVICE` from the environment at once, so a session shell does not inherit it.
`restartUnderManager` drops the record before it hands over, because the next daemon reads the same configuration folder.
`notRestartable` returns nothing for any record with a `service`, so the container kind passes it with no change there.
A terminal restart of a container record answers at once and does not wait for a record: the container runtime starts the next daemon, and the record the next daemon writes is read by `ahpd status`.
`planUpdate` refuses a container record before it reads the install place, so `--check` touches no filesystem.
A refusal is thrown in one place and answered by the terminal and the served method, so both say the same sentence.

## Final verification checklist

- [x] A daemon started with `AHPD_SERVICE=container` is seen by `ahpd status --json`, which exits 0.
- [x] A served restart and a terminal restart each leave the process exited with 75 and no successor.
- [x] `ahpd stop` and `ahpd update` under the container kind refuse with their sentences, and the daemon still runs.
- [x] `pnpm typecheck` and `pnpm test` pass.
