---
title: ahpd plugin install and remove - implemented
date: 2026-09-26
refs:
  - "[code://packages/server/src/install.ts](../../../../packages/server/src/install.ts) - install, remove and the `plugins` edit"
  - "[code://packages/computer/src/devcontainer.ts](../../../../packages/computer/src/devcontainer.ts) - `pluginInstallLine`, the container's backend install"
---

`ahpd plugin install <name>...` installs into the configuration directory and names the packages in `plugins`, and `ahpd plugin remove` does the reverse.
A dev container now gets its npm-named backends the same way, so `"plugins": ["@ahpd/agent-cofold"]` starts without a mounted checkout.

## What was built

- [`code://packages/server/src/install.ts`](../../../../packages/server/src/install.ts) - `installPlugins` and `removePlugins`, an `@ahpd/` name pinned to the daemon's version, and `plugins` edited by package name without the version or tag.
- [`code://packages/server/src/main.ts`](../../../../packages/server/src/main.ts) - `plugin install|remove`, with `--config-file`, `--no-enable` and `--keep`.
- [`code://packages/computer/src/devcontainer.ts`](../../../../packages/computer/src/devcontainer.ts) - `pluginInstallLine`: installs only what the container's `~/.config/ahpd/node_modules` lacks, with the `host` command; the server install passes `--allow-scripts=node-pty`.
- [`code://docs/CONTAINERS.md`](../../../../docs/CONTAINERS.md), [`code://docs/DAEMON.md`](../../../../docs/DAEMON.md), the README and the plugin READMEs - one install command.

## Verified

- `test/plugin-install.test.ts` (11 cases), including a scoped versioned install named without its version and a versioned remove.
- `test/devcontainer.test.ts` (19 cases), including `pluginInstallLine` under a real `/bin/sh`: nothing runs when the package is present, and only the missing spec goes to the host's own command.
- By hand, in a clean `XDG_CONFIG_HOME`: `plugin install @ahpd/agent-acp@0.7.0` wrote `@ahpd/agent-acp`, `plugin list` resolved it (`unconfigured`, needs `command`), and `plugin remove @ahpd/agent-acp@0.7.0` emptied the list and uninstalled it. Before the fix the same run wrote the version into `plugins` and `plugin list` said it was missing.
- `pnpm test` 85 files / 1125 tests, `pnpm typecheck`, `pnpm boundary` green on 2026-09-26.

## Departures from the plan

- Review fixes made after dsh's implementation: the version is stripped from `plugins`, the container uses the `host` command instead of `ahpd`, an installed package is skipped (task 02 step 4, which was missing), and the checkout-path example is back in `docs/CONTAINERS.md`.
- No `--allow-scripts` on the configuration-directory install, because npm 12 refuses it with `--prefix`.

## Left for later

- A real dev container session with `"plugins": ["@ahpd/agent-cofold"]` and no mounted checkout was not run; the launcher is covered by the fake CLI only.
