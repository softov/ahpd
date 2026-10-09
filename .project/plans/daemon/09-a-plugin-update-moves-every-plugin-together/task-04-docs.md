---
title: Docs say how to upgrade the plugins
status: implemented
depends: [task-01-plugin-update.md, task-02-a-refused-install-names-the-blocker.md, task-06-the-plugin-keeps-npms-sdk.md, task-08-the-daemon-pins-the-sdk.md]
layer: "docs"
refs:
  - "[code://docs/DAEMON.md#L36-L70](../../../../docs/DAEMON.md#L36-L70) - the plugin commands"
---

## Objective

`docs/DAEMON.md` lists `ahpd plugin update` with the other plugin commands, and says an upgrade is `npm i -g @ahpd/server` then `ahpd plugin update` then a restart. The server README says the same in one line.
`docs/DAEMON.md` says a failed `update` fails as a whole and that `update --force` installs each package on its own, so the others move and the failing one is named.

## Files

- `UPDATE: docs/DAEMON.md`
- `UPDATE: packages/server/README.md`

## Validation

- No em dash; the file's own wrapping kept.

## Resume

Implemented 2026-09-29, in the `fixes-0-8-1` worktree.
`docs/DAEMON.md` lists `ahpd plugin update` among the commands and has the upgrade as `npm i -g @ahpd/server`, `ahpd plugin update`, a restart, with what a refused install says; `packages/server/README.md` says it in one line and lists the command.
Rewritten 2026-09-29 for tasks 01 and 05: `docs/DAEMON.md` says a plugin imports the daemon's own `@ahpd/sdk` and npm installs none beside it, gives the upgrade as `npm i -g @ahpd/server`, `ahpd plugin update all`, a restart, describes `update all` and `update <name>...` with the registry-only rule, and lists both forms among the commands; the blocker sentence and "moves them all together" are gone. `packages/server/README.md` says it in one line and lists both forms. No em dash; each file's wrapping kept.
Reopened 2026-09-29 for task 06: the sentence that a plugin imports the daemon's own `@ahpd/sdk` and npm installs none beside it goes; what a refused install says comes back.
Implemented again 2026-09-29 for task 06: `docs/DAEMON.md` says every `@ahpd/*` plugin takes `@ahpd/sdk` as a peer at its own minor and npm installs it beside the plugins, keeps the `update all` / `update <name>...` text, and says again that a refused install names the blocking plugin and its version and says to run `ahpd plugin update all`. `packages/server/README.md` needed no change. No em dash; the file's wrapping kept.
Reopened 2026-09-29 for task 08: the docs say ahpd installs the daemon's `@ahpd/sdk` beside the plugins and one plugin never blocks another; the refused-install sentence goes; a plugin for another minor is refused at load.
Implemented again 2026-09-29 for tasks 08 and 09: `docs/DAEMON.md` says every plugin takes `@ahpd/sdk` as a peer and states the oldest it needs, such as `>=0.8`; ahpd installs the daemon's own `@ahpd/sdk` with every install and update and npm checks no peer, so one plugin never blocks another; a plugin whose range leaves out the daemon's sdk, such as one for an older minor saying `^0.7`, is refused at load and the others load; `install` and `update` refuse `@ahpd/sdk` by name. The refused-install sentence is gone. `docs/PLUGINS.md`'s manifest example says `">=0.8"` and its table says the range states the oldest sdk. `packages/server/README.md` says the same in one sentence after the upgrade line. No em dash; each file's wrapping kept.
Reopened 2026-10-04 for task 01's `--force`.
Implemented 2026-10-08 for `--force`: `docs/DAEMON.md`'s upgrade paragraph gained three lines, that one package npm cannot install fails the whole call and the failure says to rerun with `--force`, which gives each package its own `npm install` so the ones npm can install move and the one it cannot is the one named; its command list says the same in one clause on the `update all` row. Both keep the file's own wrapping and use no em dash.
`packages/server/README.md` needed no change: its upgrade line carries no flag for `install` either, and the `--force` failure is detail the paragraph in DAEMON.md holds.
