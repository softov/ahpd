---
title: The install script uninstalls
status: done
depends: [task-01-install-sh-installs-ahpd.md, task-02-install-ps1-installs-ahpd.md]
layer: scripts
refs:
  - "[idea: the install script uninstalls](https://github.com/softov/ahpd/blob/5e5f35ce034f24747bd952d4dfdadf2763740cbb/.project/ideas/the-install-script-uninstalls.md) - `--uninstall` and `--purge`"
  - "[code://packages/server/src/config.ts#L376-L377](../../../../packages/server/src/config.ts#L376-L377) - `configDir`, which `--purge` removes"
  - "[code://packages/server/src/install.ts#L463](../../../../packages/server/src/install.ts#L463) - `pluginRoot`: plugins live under `configDir`, so they stay without `--purge`"
  - "[code://docs/server/INSTALL.md](../../../../docs/server/INSTALL.md) - the page that names the uninstall steps"
---

## Objective

`install.sh --uninstall` and `install.ps1 -Uninstall` remove `@ahpd/server` and the PATH line that the script wrote.
The configuration folder and its plugins stay, unless `--purge` (`-Purge`) is also given.

## Files

- `UPDATE: scripts/install/install.sh` - the `--uninstall` and `--purge` flags, with `AHPD_UNINSTALL` and `AHPD_PURGE`.
- `UPDATE: scripts/install/install.ps1` - the `-Uninstall` and `-Purge` flags, with the same environment twins.
- `UPDATE: docs/server/INSTALL.md` - the uninstall section names the one line first, then the steps by hand.

## Steps

1. Write the tests first, with `AHPD_INSTALL_NO_RUN=1` and a fake home folder.
2. Add `--uninstall` and `--purge` to the flag parser, and refuse `--purge` without `--uninstall` with exit 2.
3. Run `ahpd service uninstall` when `ahpd service` reports a daemon/31 service, so the manager does not start the daemon again.
4. Run `ahpd stop` when a daemon still runs, and stop with its failure when it fails.
5. Run `npm uninstall -g @ahpd/server`, or `bun remove -g @ahpd/server` under `--runtime bun`.
6. Remove only the PATH line that the script wrote, found by its comment marker.
7. Leave the npm prefix `~/.npm-global` and its line in `~/.npmrc`.
8. With `--purge`, remove `$XDG_CONFIG_HOME/ahpd`, or `~/.config/ahpd` when the variable is not set.
9. Print the path of each removed item, and the path of each item that stays.
10. Do the same steps in `install.ps1`, with `throw` instead of `exit`.
11. Add the one line to the uninstall section of INSTALL.md.
12. Set this task and the plan's Tasks list to `implemented`.

## Validation

- A test: after an install and `--uninstall`, `ahpd` is not on PATH and the rc file has no ahpd line.
- A test: a line that the person wrote in the rc file stays.
- A test: without `--purge`, the configuration folder stays; with `--purge`, it is gone.
- A test: `--purge` alone exits 2.
- A test: the script runs `ahpd service uninstall`, then `ahpd stop`, before it removes the package.
- A test: `~/.npmrc` keeps its `prefix` line.
- A test: `--dry-run --uninstall` prints the steps and removes nothing.
- CI runs the uninstall after the install in the clean container and on the Windows runner.

## Resume

- **Done so far:** `install.sh --uninstall` removes the daemon/31 service file or a record that names `service`, and stops a daemon that still runs. It removes `@ahpd/server`, or `bun remove -g` under Bun, and takes out only the marked PATH line. The npm prefix and `~/.npmrc` stay, and the configuration goes only under `--purge`. `--purge` without `--uninstall` exits 2, and `--dry-run --uninstall` prints each step and removes nothing. `install.ps1 -Uninstall` does the same with `throw`, minus the service step because daemon/31 gives Windows no service. It removes the user PATH entry by value. `docs/server/INSTALL.md` has an Uninstall section with the one line first and the by-hand steps after it. The shell tests grew to 14 cases and the PowerShell tests to 12. The CI `install` job runs the uninstall after the install and checks that `ahpd` and the PATH line are gone. `install-windows` runs `-Uninstall` and checks the shim.
- **Next action:** task 03, which is the ahpio-site work and stays `todo` here because it is another repository.
- **Open questions:** the task says "when `ahpd service` reports a service", and the CLI has no such verb. The script reads the daemon/31 service file, or the `service` field that `ahpd status --json` prints for a manager-started daemon, and then runs `ahpd service uninstall`.
- **Watch out for:** the uninstall names the package, not `package@version`, because a version may be the one an upgrade replaced. A Windows PATH has no comment marker, so the uninstall removes the folder by value; the install only adds that entry when it is absent.
