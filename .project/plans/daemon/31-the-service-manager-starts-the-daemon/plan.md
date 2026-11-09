---
title: The service manager starts the daemon
domain: daemon
status: built
priority: medium
created: 2026-10-16
revalidated: 2026-10-16
refs:
  - "[code://packages/server/src/daemon.ts#L30-L82](../../../../packages/server/src/daemon.ts#L30-L82) - `Running`, the record that `status`, `stop` and `restart` read"
  - "[code://packages/server/src/daemon.ts#L422-L540](../../../../packages/server/src/daemon.ts#L422-L540) - `start`: the parent spawns the child and writes the record, so a daemon in the foreground has no record"
  - "[code://packages/server/src/daemon.ts#L542-L554](../../../../packages/server/src/daemon.ts#L542-L554) - `claim`, the one writer of `daemon.json`"
  - "[code://packages/server/src/daemon.ts#L716-L740](../../../../packages/server/src/daemon.ts#L716-L740) - `stop`: a signal to the recorded pid, a wait, then SIGKILL"
  - "[code://packages/server/src/commands/run.ts#L197-L212](../../../../packages/server/src/commands/run.ts#L197-L212) - `runForeground` reads `AHPD_DETACHED` and `AHPD_CONTROL` and removes them from the environment"
  - "[code://packages/server/src/commands/run.ts#L1223-L1224](../../../../packages/server/src/commands/run.ts#L1223-L1224) - SIGINT and SIGTERM run the way down in every daemon"
  - "[code://packages/server/src/commands/run.ts#L1253-L1280](../../../../packages/server/src/commands/run.ts#L1253-L1280) - the restart signals and the control pipe, only in a detached daemon"
  - "[code://packages/server/src/commands/run.ts#L1327-L1347](../../../../packages/server/src/commands/run.ts#L1327-L1347) - `daemon.run`, what `ahpd` with no command runs"
  - "[code://packages/server/src/commands/restart.ts#L1-L11](../../../../packages/server/src/commands/restart.ts#L1-L11) - a restart starts its successor itself, from the record"
  - "[code://packages/server/src/commands/restart.ts#L490-L493](../../../../packages/server/src/commands/restart.ts#L490-L493) - a restart at the terminal refuses a daemon with no record"
  - "[code://packages/server/src/commands/status.ts#L28-L34](../../../../packages/server/src/commands/status.ts#L28-L34) - `status` reads the record and says `None running.` without one"
  - "[code://packages/server/src/commands/options.ts#L1129-L1166](../../../../packages/server/src/commands/options.ts#L1129-L1166) - `secret`: a missing token file is written, which is how a supervisor shares one secret"
  - "[code://packages/server/src/config.ts#L250-L258](../../../../packages/server/src/config.ts#L250-L258) - `shellEnv`, which names a service unit and covers agent shells only"
  - "[code://packages/server/src/commands/registry.ts#L56-L74](../../../../packages/server/src/commands/registry.ts#L56-L74) - `cliRegistry`, where a `service` group is declared"
  - "[code://docs/server/RUN.md](../../../../docs/server/RUN.md) - the page for start, stop and restart"
  - https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html - `Type=`, `Restart=` and `KillMode=` of a systemd unit
  - https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html - a LaunchAgent plist, `RunAtLoad` and `KeepAlive`
---

## Goal

`ahpd service install` makes the service manager of this machine start the daemon at login and keep it running.
On Linux that is a systemd user unit, and on macOS a LaunchAgent.
The command enables the service, waits for the port, and prints the address and the token file.
`ahpd service uninstall` stops the service and removes its file.
The service runs the same foreground daemon as `ahpd` at a terminal, with the configuration file of the install.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n -i "systemd|launchd|launchagent|schtasks" .project docs packages/server/src` - only the idea names them.
- `rg -n "DETACHED_ENV|foreground" packages/server/src` - only a daemon that `ahpd start` spawned listens for the restart signals.
- `rg -n "claim\(|writeJsonAtomic\(daemonPath" packages/server/src` - only the parent of `start` writes `daemon.json`.

### Runtime path

```
ahpd service install -> unit file from the config -> systemctl --user enable --now (or launchctl bootstrap) -> ahpd (daemon.run) -> listen -> install reads the announcement -> address and token file printed
```

### What is true now

- The idea says the unit runs `ahpd start` in the foreground. `ahpd start` detaches, so the unit runs `ahpd` with no command, which is `daemon.run`.
- A daemon in the foreground writes no record, so `ahpd status` says `None running.` and `ahpd stop` has nothing to stop.
- `ahpd restart` refuses a daemon with no record. A served restart starts the successor with `start`, as a new detached process.
- Under systemd, a successor that the old process spawns is in the old unit's cgroup. When the old main process exits, `KillMode=control-group` ends the successor too.
- A unit and a LaunchAgent do not get the login shell's `PATH` or variables. `shellEnv` changes only what agent shells get.

### Gaps

- No record for a supervised daemon, so the three verbs do not see it.
- No way for `stop` and `restart` to ask a service manager.
- `Not found: a command that writes a unit or a plist - searched service, unit and plist in packages/server/src.`

## Answers

| What | Source | Task |
| --- | --- | --- |
| The service runs `ahpd` with no command and `--config <file>` of the install | (defaulted: `ahpd start` detaches, and the idea asks for the same daemon as a start by hand) | 03, 04 |
| A systemd user unit on Linux and a LaunchAgent on macOS, without sudo | the idea, 2026-10-14 | 03, 04 |
| `service install` waits for the announcement as `start` does, with `READY_TIMEOUT_MS` | (defaulted: one wait and one timeout for every start) | 03, 04 |
| `service install` prints the address and where the token comes from, never the token | (defaulted: `status` and `start` never print it) | 03, 04 |
| `service uninstall` stops the service, then removes the unit file and the record | the idea, 2026-10-14 | 03, 04 |
| A second `service install` writes the file again and restarts the service | (defaulted: the file follows the config of the latest install) | 03, 04 |
| `stop` and `restart` call `systemctl --user` or `launchctl` when the record names a service | Softov, 2026-10-16, chose the recommended answer for "Who supervises the daemon when a service is installed?" | 02 |
| `service install` writes the `PATH` of the shell that runs it into the unit or the plist | Softov, 2026-10-16, chose the recommended answer for "Where does the service get its environment?" | 03, 04 |
| Windows is not in this plan | Softov, 2026-10-16, chose the recommended answer for "Is Windows in this plan?" | - |
| The unit has `Restart=on-failure`, and the plist restarts on a crash only | Softov, 2026-10-16, chose the recommended answer for "Which restart policy does the unit get?" | 03, 04 |
| The install script of daemon/27 prints `ahpd service install` as a next step and asks nothing | Softov, 2026-10-16, chose the recommended answer for "Does the install script of daemon/27 offer `ahpd service install`?" | - |

## Proposed architecture

- **Data flow** - `service install` reads the configuration path, the binary path and `process.execPath`. It writes one unit or one plist that runs `<node> <ahpd> --config <file>`.
- **Record** - the unit sets one environment variable, for example `AHPD_SERVICE=systemd`. `runForeground` reads it, removes it, and writes its own record with a `service` field.
- **Supervision** - `stop` and `restart` call the service manager when the record has a `service` field.
- **Environment** - `service install` writes the `PATH` of its shell into the unit or the plist.
- **Layer responsibilities** - server: the `service` group, the record field, and the calls to `systemctl` and `launchctl`. sdk: nothing.
- **Source-of-truth files** - CREATE: `packages/server/src/service.ts`, `packages/server/src/commands/service.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A supervised daemon writes its record](task-01-a-supervised-daemon-writes-its-record.md) | done | - |
| [02 - Stop and restart ask the manager](task-02-stop-and-restart-ask-the-manager.md) | done | 01 |
| [03 - Service install writes a systemd unit](task-03-service-install-writes-a-systemd-unit.md) | done | 01, 02 |
| [04 - Service install writes a LaunchAgent](task-04-service-install-writes-a-launch-agent.md) | done | 01, 02 |
| [05 - The docs say how to run it as a service](task-05-the-docs-say-how-to-run-as-a-service.md) | done | 03, 04 |

## Relations

- **Requires:** nothing. The record, `stop` and `restart` are built (daemon/13, daemon/20, daemon/21).
- **Blocks:** nothing.
- [daemon/27](../27-ahpd-installs-with-one-line/plan.md) prints `ahpd service install` as a next step after `ahpd configure`. Its `--uninstall` task removes the service when one is installed.
- [daemon/29](../29-ahpd-doctor-says-what-is-wrong/plan.md) can add a check for the service once this plan is built: the unit is enabled, and the record names it.
- [daemon/28](../28-setup-finds-the-runtimes-and-agents/plan.md) finds the agent CLIs on the `PATH` of the terminal. The service gets that `PATH` because `service install` writes it into the unit.

## Risks and tradeoffs

- A served restart spawns its successor inside the unit - Task 02 sends a supervised restart to the manager, so no successor is spawned.
- The binary path in the unit goes stale after an npm prefix change - A second `service install` writes it again, and docs/server/RUN.md says so.
- A Node from nvm is not on the service's `PATH` - The unit names `process.execPath` in full.

## Resume state

- **Done so far:** the plan, 2026-10-16, and every task built and passing on 2026-10-16: 01, 02 and 03, then 04 and 05. Softov answered the open questions on 2026-10-16. On review (2026-10-18) `service install` now resolves a relative `--config-file` to a full path, with a test.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
The checks at the end of this file need a systemd user session and a Mac. Neither task could run them here.
On Debian, every check by hand passed on 2026-10-20. The macOS checks are in [pending/macos-service-checks.md](../../../pending/macos-service-checks.md).
- **Open questions:** none.
- **Watch out for:**
`runForeground` removes `AHPD_DETACHED` from the environment at once, so a session shell does not inherit it. Do the same with `AHPD_SERVICE`.
One config folder holds one record.
`claim` refuses a live daemon that is not the one it replaces.
The announcement is one write that starts at the first column. `announcementOf` reads it back with `^ahpd on ws://`, so an indented line is a daemon no `start` finds.
A supervised daemon's record holds no line. `stop` and `restart` must choose the manager from the record before they read `argv`.
A restart of a supervised daemon starts its successor with the manager, not in this process.
`service install` waits on the record, because a supervised daemon writes no log file.
A unit is a file the daemon does not parse, so it names `process.execPath` and the configuration file in full.
`installStarts` says whether the manager's install starts the service. The command restarts after writing the file only where it does not.

## Final verification checklist

- [x] On Debian, `ahpd service install` starts the daemon, `ahpd status` sees it, and a logout and a login start it again.
- [ ] `ahpd stop` and `ahpd restart` under the service leave one daemon or none, and no second process.
- [ ] On macOS, the same checks with the LaunchAgent.
- [ ] `ahpd service uninstall` leaves no unit, no plist and no record.
