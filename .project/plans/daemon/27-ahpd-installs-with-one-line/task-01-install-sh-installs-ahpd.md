---
title: install.sh installs ahpd
status: done
depends: []
layer: scripts
refs:
  - "[code://packages/server/package.json#L38-L40](../../../../packages/server/package.json#L38-L40) - `engines.node` is `>=22.1`, the floor that the script checks"
  - "[code://packages/server/src/pty.ts](../../../../packages/server/src/pty.ts) - node-pty is optional, so a failed native build is a warning"
  - "[code://packages/server/src/commands/configure.ts](../../../../packages/server/src/commands/configure.ts) - `ahpd configure`, which the script runs on a TTY"
  - "[code://packages/server/src/commands/plugin.ts#L181](../../../../packages/server/src/commands/plugin.ts#L181) - `ahpd plugin update all`, which an upgrade runs"
  - "[code://.github/workflows/ci.yml](../../../../.github/workflows/ci.yml) - the jobs that the install job goes beside"
  - "[code://tools/posix.ts](../../../../tools/posix.ts) - `posix`, which skips the bash tests on Windows"
  - "[research: how one-line installers work](../../../research/one-line-installers.md) - OpenClaw's steps, which the script scales down"
---

## Objective

`curl -fsSL https://ahpio.com/ahpd/install.sh | bash` installs `@ahpd/server` without sudo, puts `ahpd` on PATH, and runs `ahpd configure` on a TTY.
A second run upgrades the package and its plugins, and adds no second PATH line.

## Files

- `CREATE: scripts/install/install.sh` - the script: flags and their `AHPD_*` twins, the runtime check, the npm prefix, the install, the PATH line, the upgrade, and onboarding.
- `CREATE: scripts/install/test/install-sh.test.ts` - vitest cases that source the script with `AHPD_INSTALL_NO_RUN=1` in a fake home folder, with stub `node`, `npm` and `ahpd` commands on PATH.
- `UPDATE: .github/workflows/ci.yml` - an `install` job that runs the script in clean Debian containers: no Node, Node 20, and Node 22.

## Steps

1. Write the tests first, with a fake `HOME` and stub commands that record their arguments.
2. Parse `--version`, `--package`, `--runtime`, `--no-onboard`, `--dry-run`, `--verbose` and `--help`, each with its `AHPD_*` environment twin.
3. Refuse an unknown flag, and an unknown `--runtime` value, with exit 2.
4. Refuse a run under `sudo` from a user shell, as the research note says Claude Code does.
5. Find `node` 22.1 or later on PATH, then in nvm.
6. When no Node fits and a TTY is open, ask, then install Node through nvm.
7. When no Node fits and no TTY is open, stop and print the nvm command.
8. Under `--runtime bun`, find `bun` and use `bun add -g` instead of the npm steps.
9. Set the npm prefix to `~/.npm-global` when the global prefix is not writable.
10. Run `npm install -g --no-fund --no-audit` on the `--package` value, `@ahpd/server` by default, with `--allow-scripts=node-pty` on npm 11.16 or later.
11. Warn and name the build tools when the node-pty build fails, and go on.
12. Add the npm bin folder to the rc file of `$SHELL`, with a comment marker.
13. Add no second PATH line on a second run.
14. On an upgrade, run `ahpd plugin update all` and print `ahpd restart`, and never restart the daemon.
15. On a TTY and without `--no-onboard`, run `ahpd configure` with stdin from `/dev/tty`.
16. Print `ahpd service install` as a next step, and ask nothing about it.
17. Under `--dry-run`, print each step and change nothing.
18. Add the `install` job to `ci.yml`, with each container case as one matrix entry.
19. Set this task and the plan's Tasks table to `implemented`.

## Validation

- A test: a fresh run in a fake home folder runs the npm install.
- A test: a fresh run writes one PATH line with the marker.
- A test: a second run writes no second PATH line, and runs `ahpd plugin update all`.
- A test: an unknown flag exits 2, and `--runtime deno` exits 2.
- A test: without a TTY and without Node 22.1, the script stops with the nvm command and exits non-zero.
- A test: a writable global prefix keeps it, and a prefix that is not writable gets `~/.npm-global`.
- A test: npm 11.15 gets no `--allow-scripts`, and npm 11.16 gets it.
- A test: `--dry-run` changes no file in the fake home folder.
- A test: `--runtime bun` runs `bun add -g @ahpd/server`.
- The tests skip on Windows through `posix`.
- `pnpm test:unit` passes, and the `install` job passes in all three containers.

## Resume

- **Done so far:** `scripts/install/install.sh` parses every flag and its `AHPD_*` twin and refuses sudo. It finds Node 22.1 or later on the PATH and then in nvm, and asks on a TTY before installing nvm and Node. Without a terminal it stops with the nvm command. Under `--runtime bun` it uses `bun add -g`, and it moves to `~/.npm-global` when the global prefix is not writable. It installs with `--allow-scripts=node-pty` only on npm 11.16 or later, and warns on a node-pty build failure instead of stopping. It writes the marked PATH line once. On an upgrade it runs `ahpd plugin update all` and prints `ahpd restart`. On a TTY it runs `ahpd configure` from `/dev/tty`. It prints `ahpd service install`, and changes nothing under `--dry-run`. `scripts/install/test/install-sh.test.ts` has 14 cases over stub commands and a fake home folder, and they pass. The `install` CI job runs the script in `debian:12-slim`, `node:20-bookworm-slim` and `node:22-bookworm-slim`.
- **Next action:** task 02, `install.ps1`.
- **Open questions:** none. `NVM_INSTALL_URL` is pinned to `v0.40.8`, the latest nvm release on 2026-10-19.
- **Watch out for:** a piped script reads stdin from the pipe, so every question reads from `/dev/tty`. The tests source the script with `AHPD_INSTALL_NO_RUN=1` and call `main`, so `set -euo pipefail` is in force in the test shell too. The stub `node` is first on the test PATH, so a Node on the host does not decide the result.
