---
title: install.ps1 installs ahpd
status: done
depends: [task-01-install-sh-installs-ahpd.md]
layer: scripts
refs:
  - "[code://packages/server/package.json#L38-L40](../../../../packages/server/package.json#L38-L40) - `engines.node` is `>=22.1`, the floor that the script checks"
  - "[code://.github/workflows/ci.yml#L60-L104](../../../../.github/workflows/ci.yml#L60-L104) - `check-windows`, the Windows runner the test runs on"
  - "[research: how one-line installers work](../../../research/one-line-installers.md) - `irm | iex` cannot pass parameters, and `throw` keeps the window open"
---

## Objective

`irm https://ahpio.com/ahpd/install.ps1 | iex` installs `@ahpd/server` on Windows, puts `ahpd` on the user PATH, and runs `ahpd configure` in an interactive session.
It does the same steps as `install.sh`, with PowerShell names for the flags.

## Files

- `CREATE: scripts/install/install.ps1` - the script: `-Version`, `-Package`, `-Runtime`, `-NoOnboard`, `-DryRun`, `-Verbose` and `-Help`, each with its `AHPD_*` twin.
- `CREATE: scripts/install/test/install-ps1.test.ts` - vitest cases that run the script under `pwsh` with `AHPD_INSTALL_NO_RUN=1` and stub commands, skipped where `pwsh` is not found.
- `UPDATE: .github/workflows/ci.yml` - an `install-windows` job that runs the script on `windows-latest`, with Node 22 and without Node.

## Steps

1. Write the tests first, with a fake `USERPROFILE` and stub commands that record their arguments.
2. Read each parameter, and its `AHPD_*` environment variable when the parameter is not given.
3. Refuse an unknown `-Runtime` value with `throw`, and never call `exit`.
4. Find `node` 22.1 or later on PATH.
5. When no Node fits in an interactive session, ask, then install Node.
6. When no Node fits in a session that is not interactive, stop and print the command.
7. Under `-Runtime bun`, find `bun` and use `bun add -g` instead of the npm steps.
8. Run `npm install -g --no-fund --no-audit` on the `-Package` value, `@ahpd/server` by default, with `--allow-scripts=node-pty` on npm 11.16 or later.
9. Add the npm bin folder to the user PATH when it is not there, and add no second entry.
10. On an upgrade, run `ahpd plugin update all` and print `ahpd restart`.
11. In an interactive session and without `-NoOnboard`, run `ahpd configure`.
12. Print no `ahpd service install` line, because daemon/31 has no Windows service.
13. Under `-DryRun`, print each step and change nothing.
14. Add the `install-windows` job to `ci.yml`.
15. Set this task and the plan's Tasks table to `implemented`.

## Validation

- A test: a fresh run in a fake profile runs the npm install and adds one user PATH entry.
- A test: a second run adds no second PATH entry, and runs `ahpd plugin update all`.
- A test: an unknown `-Runtime` value throws, and the session stays open.
- A test: `$env:AHPD_NO_ONBOARD = '1'` skips `ahpd configure`, as `-NoOnboard` does.
- A test: `-DryRun` changes nothing in the fake profile.
- The `install-windows` job passes with Node 22 and stops with the Node command without Node.

## Resume

- **Done so far:** `scripts/install/install.ps1` reads every flag and its `AHPD_*` twin, and it throws instead of exiting. It finds Node 22.1 or later and asks on a terminal before installing one. A missing Node gets `winget install OpenJS.NodeJS.LTS`, and no terminal throws with that command. Under `-Runtime bun` it uses `bun add -g`. It installs with `--allow-scripts=node-pty` only on npm 11.16 or later, and warns on a failed node-pty build instead of stopping. It adds the npm folder to the user PATH once. On an upgrade it runs `ahpd plugin update all` and prints `ahpd restart`. On a terminal it runs `ahpd configure` unless `-NoOnboard`. It prints no `ahpd service install` line, and changes nothing under `-DryRun`. `scripts/install/test/install-ps1.test.ts` has 12 cases and skips unless the platform is Windows and `pwsh` is found. The `install-windows` CI job installs with Node 22. It also checks that the job stops with the winget command when the PATH has no Node.
- **Next action:** task 04, the uninstall in both scripts.
- **Open questions:** none beyond task 01's nvm tag.
- **Watch out for:** under `iex`, `exit` closes the person's window, so use `throw`. A flag passes only as `& ([scriptblock]::Create((irm <url>))) -NoOnboard`, so every flag needs its environment twin. The user PATH is written with `[Environment]::SetEnvironmentVariable(..., 'User')`, which .NET implements only on Windows, which is why the tests skip elsewhere. A runner hands each step its own environment, so the `install-windows` job names the npm folder again before `ahpd --version`.
