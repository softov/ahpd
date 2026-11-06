---
title: Service install writes a systemd unit
status: done
depends:
  - task-01-a-supervised-daemon-writes-its-record.md
  - task-02-stop-and-restart-ask-the-manager.md
layer: server
refs:
  - "[code://packages/server/src/commands/registry.ts#L56-L74](../../../../packages/server/src/commands/registry.ts#L56-L74) - `cliRegistry`"
  - "[code://packages/server/src/commands/start.ts#L80-L146](../../../../packages/server/src/commands/start.ts#L80-L146) - `daemon.start`, the command shape and the lines it prints"
  - "[code://packages/server/src/daemon.ts#L89](../../../../packages/server/src/daemon.ts#L89) - `READY_TIMEOUT_MS`"
---

## Objective

On Linux, `ahpd service install` writes `~/.config/systemd/user/ahpd.service`, enables it, waits for the daemon, and prints its address.
`ahpd service uninstall` disables the unit, stops the daemon, and removes the file.

## Files

- `CREATE: packages/server/src/commands/service.ts` - the `service install` and `service uninstall` commands.
- `UPDATE: packages/server/src/service.ts` - `unitOf`, the unit text, and `install` and `uninstall` for systemd.
- `UPDATE: packages/server/src/commands/registry.ts:56-74` - declare the `service` group.
- `CREATE: packages/server/test/service.test.ts` - the unit text and the command, with a fake manager.

## Steps

1. Write the tests first.
2. Write `unitOf` with `ExecStart=<node> <ahpd> --config <file>` and `Environment=AHPD_SERVICE=systemd`.
3. Write `Restart=on-failure`, and `Environment=PATH=` with the `PATH` of the shell that runs the install.
4. Refuse `service install` when `ahpd start` already runs a daemon, and name `ahpd stop`.
5. Write the file, then run `systemctl --user daemon-reload` and `systemctl --user enable --now ahpd`.
6. Wait for the record from task 01, with `READY_TIMEOUT_MS`, and print the address and the token line.
7. Write `service uninstall`: `systemctl --user disable --now ahpd`, then remove the file and the record.
8. Say on a machine with no `systemctl` that the command needs systemd, and exit with a configuration failure.
9. Set this task and the plan row to `implemented`.

## Validation

- A test: the unit text names `process.execPath`, the ahpd binary and the configuration file.
- A test: install calls `daemon-reload` and `enable --now`, and prints the address and no token.
- A test: install refuses while a daemon from `ahpd start` runs.
- A test: uninstall calls `disable --now` and removes the file.
- By hand on Debian: install, `ahpd status`, logout and login, `ahpd restart`, uninstall.

## Resume

Done 2026-10-16. Every step is built, and every case the Validation names passes, except the one run by hand. Not reviewed.

`packages/server/src/service.ts` gained the file half and the install half of the manager.
`unitFile()` is `configHome()/systemd/user/ahpd.service`.
`unitOf(facts)` builds the unit from `process.execPath`, `process.argv[1]`, the configuration file and the install shell's `PATH`.
`unitWord` quotes a word that a unit would split, and doubles `%`.
`installCalls` and `uninstallCalls` are the call sequences, with both managers' arms in one table.
`serviceOn(platform)` answers `systemd` on Linux and nothing elsewhere.

`Installer` is a second interface beside `Manager`, with `install` and `uninstall`.
`realManager` answers both, so fakes that only stop or restart are unchanged.
Each call is one command run by name.
A sequence stops at the first non-zero answer and names it with its first output line.

`packages/server/src/commands/service.ts` is new.
`install` refuses a daemon left running by `ahpd start`, and names `ahpd stop`.
It reads the token line from the daemon's own configuration file (`namedOptionsFrom` and `secret`).
It writes the unit, then asks the manager for `daemon-reload` and `enable --now`.
It restarts the service when a daemon already ran under it.
It then waits on the record for `READY_TIMEOUT_MS`.
It prints `statusLine`, the folders, the automations and the `from` line, and never the token.
`uninstall` asks for `disable --now`, forgets the record of a service daemon and removes the file.
It leaves a daemon from `ahpd start` alone, and asks before it runs unless `--yes` is given.

Files: `packages/server/src/service.ts`, `packages/server/src/commands/service.ts`, `packages/server/src/commands/registry.ts`, `packages/server/test/service.test.ts`, `packages/server/test/server-cli-service.test.ts`, `packages/server/test/cli.ts`.

Departures from this file:

- Step 2 says `--config <file>`, but the flag is `--config-file`, and the unit uses it. Task 04 found that the first version used `--config` (see the amendment below).
- The unit also writes `KillMode=control-group`, which the plan names in its refs but the steps do not.
- `installCalls` and `uninstallCalls` carry the launchd arm now, to keep one table. Task 04 adds the plist path and the manager choice.
- `serviceOn` answers only `linux`, so `service install` on macOS fails with a configuration error until task 04.
- `Manager` has no install verbs, so the five fake managers did not change.
- The command cases are in the new `server-cli-service.test.ts`, not `service.test.ts`. They need the `systemctl` stand-in on a `PATH`, which `cli.ts` provides.
- `cli.ts`'s `recordOf()` returns the named `Recorded` interface, so the install case can compare the printed line to the whole record.
- Step 8 asked for a machine with no `systemctl`. The code checks the platform instead.
- A Linux machine without systemd is refused with the words of `systemctl`, because a probe would run before the install has anything to ask.

Validation: `pnpm -s build`, `pnpm -s typecheck`, `pnpm -s boundary` and `node tools/schema.mjs` pass.
`git diff --quiet tools/` is clean afterwards.
`packages/server` vitest: 57 files and 1159 tests pass, with `--maxWorkers=2 --testTimeout=10000`.
The new cases are 15 in `service.test.ts` and 5 in `server-cli-service.test.ts`.

Left: `By hand on Debian: install, ahpd status, logout and login, ahpd restart, uninstall` was not run.
This machine has no systemd user session, so Softov must run it on one that has.

Amended 2026-10-16 by task 04: the first departure above was wrong.
`ExecStart` was written with `--config`, which this CLI does not take, so the daemon would never have come up.
Both files say `--config-file` now.
The install case runs the `ExecStart` line read from the unit, which is the check that was missing.
