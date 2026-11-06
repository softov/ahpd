---
title: The docs say how to run it as a service
status: done
depends:
  - task-03-service-install-writes-a-systemd-unit.md
  - task-04-service-install-writes-a-launch-agent.md
layer: docs
refs:
  - "[code://docs/server/RUN.md](../../../../docs/server/RUN.md) - start, stop and restart"
  - "[code://docs/server/REFERENCE.md](../../../../docs/server/REFERENCE.md) - the command reference"
---

## Objective

docs/server/RUN.md has a section on the service.
It says how to install it, what `stop` and `restart` do, where its log is, and how to remove it.

## Files

- `UPDATE: docs/server/RUN.md` - a `Service` section after `Restart`.
- `UPDATE: docs/server/REFERENCE.md` - the generated rows for `service install` and `service uninstall`.

## Steps

1. Write the `Service` section, with one example for Linux and one for macOS.
2. Say that the service gets the `PATH` of the shell that ran `service install`.
3. Say that a second `service install` writes the file again after an upgrade.
4. Generate the reference again, and check the two new rows.
5. Set this task and the plan row to `implemented`.

## Validation

- RUN.md names both commands, the log and the environment.
- The reference holds `service install` and `service uninstall`.

## Resume

Done 2026-10-16. Every step is built and every case the Validation names passes. Not reviewed.

`docs/server/RUN.md` has a `Service` section after `Restart`.
It says what the install hands the manager and what the daemon records itself as.
It names the two files and their platforms: the systemd user unit under the configuration home, and the LaunchAgent under `~/Library/LaunchAgents`.
It says the install needs no sudo.
It says the interpreter is written in full, so an nvm `node` needs no `PATH` of its own.
It says the file gets the `PATH` of the shell that ran the install.
It says what `stop` and `restart` do under a service, and why a signal is not the way to stop a supervised daemon.
It says where the log is: the journal on Linux, `daemon.log` on macOS.
It says the service starts in the home folder, which a run with no `paths` serves.
It says a second install after an upgrade rewrites the file and starts the daemon from it.
It says `service uninstall` stops the daemon and removes the file.
It shows one status line from an install, and the refusal while a daemon from `ahpd start` runs.

Departure from this file: `docs/server/REFERENCE.md` needed no edit.
Its tables come from the `CliReference` component, built from the server at site build time, so the file has no rows to add.
`pnpm -s docs:build` renders both `ahpd service install` and `ahpd service uninstall` from `docs/server/reference.data.ts`.
The same two are in `ahpd --help`.

Validation: `pnpm -s docs:build` passes in 14.7 s, and the built site holds the section and both rows.
`pnpm -s build`, `pnpm -s typecheck`, `pnpm -s boundary` and `node tools/schema.mjs` pass.
`git diff --quiet tools/` is clean afterwards.
