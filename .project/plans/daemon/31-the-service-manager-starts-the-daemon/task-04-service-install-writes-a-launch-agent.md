---
title: Service install writes a LaunchAgent
status: done
depends:
  - task-01-a-supervised-daemon-writes-its-record.md
  - task-02-stop-and-restart-ask-the-manager.md
layer: server
refs:
  - "[code://packages/server/src/commands/start.ts#L80-L146](../../../../packages/server/src/commands/start.ts#L80-L146) - `daemon.start`, the lines it prints"
  - https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html - the plist keys
---

## Objective

On macOS, `ahpd service install` writes `~/Library/LaunchAgents/dev.ahpd.daemon.plist`, loads it, waits for the daemon, and prints its address.
`ahpd service uninstall` unloads it and removes the file.

## Files

- `UPDATE: packages/server/src/service.ts` - `plistOf`, the plist text, and `install` and `uninstall` for launchd.
- `UPDATE: packages/server/src/commands/service.ts` - choose launchd on `darwin`.
- `UPDATE: packages/server/test/service.test.ts` - the plist text and the launchd calls.

## Steps

1. Write the tests first.
2. Write `plistOf` with `ProgramArguments`, `RunAtLoad`, and `AHPD_SERVICE=launchd` in `EnvironmentVariables`.
3. Write `KeepAlive` with `SuccessfulExit` false, and the `PATH` of the shell in `EnvironmentVariables`.
4. Send the daemon's output to `daemon.log`, with `StandardOutPath` and `StandardErrorPath`.
5. Load the file with `launchctl bootstrap gui/<uid>`, then wait for the record as task 03 does.
6. Unload it with `launchctl bootout gui/<uid>/dev.ahpd.daemon`, then remove the file and the record.
7. Set this task and the plan row to `implemented`.

## Validation

- A test: the plist names `process.execPath`, the ahpd binary, the configuration file and the log.
- A test: install calls `bootstrap`, and uninstall calls `bootout`.
- By hand on macOS: install, `ahpd status`, logout and login, `ahpd restart`, uninstall.

## Resume

Done 2026-10-16. Every step is built, and every case the Validation names passes, except the one run by hand. Not reviewed.

`plistOf` builds the agent text from the same facts as the unit.
`ProgramArguments` has one string per argument: `process.execPath`, the ahpd entry, `--config-file` and the configuration file.
launchd splits nothing, so no word is quoted, and `plistWord` writes the three risky path characters as XML references.
`RunAtLoad` starts the agent at login.
`KeepAlive` with `SuccessfulExit` false restarts after a crash and leaves a managed restart alone.
`AHPD_SERVICE` names the manager, and the install shell's `PATH` is included.
`StandardOutPath` and `StandardErrorPath` are both `daemonLog()`, because macOS has no journal.

`agentFile()` is `~/Library/LaunchAgents/dev.ahpd.daemon.plist`, the only folder launchd reads for a login.
`installFile` and `installText` choose the unit or the agent from the manager.
`serviceOn('darwin')` answers `launchd`, and the refusal on other platforms names both managers.

`launchctl bootstrap` refuses a label that is already loaded, so `installCalls('launchd', ...)` is `bootout` then `bootstrap`.
A `bootout` of an agent that was never loaded refuses, so `Call` gained an optional `tolerate`.
`realManager` goes past a refusal only where `tolerate` is set.
`installStarts` says whether the manager's install already starts the service.
For systemd it does not, so the command restarts after `enable --now`.
For launchd `bootstrap` is the start, and a restart after it would stop a daemon that just came up.

Files: `packages/server/src/service.ts`, `packages/server/src/commands/service.ts`, `packages/server/test/service.test.ts`, `packages/server/test/server-cli-service.test.ts`.

Departures from this file:

- Task 03 wrote `--config` in `ExecStart`, but the flag is `--config-file`. Both files use `--config-file` now.
- The case that would have caught it now runs the `ExecStart` line read from the unit.
- Both files name `WorkingDirectory`, which the steps do not ask for.
- A daemon with no `paths` serves its start folder. launchd starts a job in the root folder, and systemd defaults to the home.
- `ServiceFacts` gained `log` and `home`. The unit uses `home` only.
- `StandardOutPath` and `StandardErrorPath` name the same file, so output and failures are read in one place.
- The plist has no document type declaration, because launchd's parser needs only the elements.
- `serviceOn` and the launchd arm of `installCalls` came from task 03. This task adds the `darwin` case and the `bootout`.
- The command description now says the install hands the file to the manager, not that it enables it.
- The refusal on a platform with no manager names systemd and launchd.

Validation: `pnpm -s build`, `pnpm -s typecheck`, `pnpm -s boundary` and `node tools/schema.mjs` pass.
`git diff --quiet tools/` is clean afterwards.
`packages/server` vitest: 57 files and 1173 tests pass, with `--maxWorkers=2 --testTimeout=10000`.
The whole suite passes: 291 files and 5227 tests, except `packages/sdk/test/nested-proxy.test.ts`.
That case timed out on a loaded box and passes alone at `--testTimeout 30000` (49 of 49).
`pnpm -s docs:build` passes in 14.7 s.
There are 14 new cases in `service.test.ts`, which now has 36.

Left: an uninstall of an agent that is not loaded refuses and removes nothing.
`tolerate` is on the `bootout` of the install only.
On uninstall, a refused unload may mean a daemon still runs, and it must not serve without its file and record.

Left: `By hand on macOS: install, ahpd status, logout and login, ahpd restart, uninstall` was not run.
This machine has no launchd, so Softov must run it on a Mac.
No case covers a second install over a running service.
The calls are asserted, but no daemon came up under them.
