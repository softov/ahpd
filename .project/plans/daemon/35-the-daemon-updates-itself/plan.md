---
title: The daemon updates itself
domain: daemon
status: built
priority: medium
created: 2026-10-18
revalidated: 2026-10-18
requires:
  - plans/daemon/09-a-plugin-update-moves-every-plugin-together/plan.md
  - plans/daemon/13-ahpd-restart/plan.md
refs:
  - "[code://packages/server/src/commands/restart.ts#L683-L719](../../../../packages/server/src/commands/restart.ts#L683-L719) - `daemon.restart`, the declaration this command mirrors: `force`, `config:write`, `deploymentTokenOnly`"
  - "[code://packages/server/src/commands/restart.ts#L98-L114](../../../../packages/server/src/commands/restart.ts#L98-L114) - `FOREGROUND`, `busy` and `notRestartable`, the refusals this command reuses"
  - "[code://packages/server/src/commands/restart.ts#L396-L418](../../../../packages/server/src/commands/restart.ts#L396-L418) - `successorTakes`, which asks the binary on disk whether it takes the recorded line"
  - "[code://packages/server/src/commands/restart.ts#L206-L232](../../../../packages/server/src/commands/restart.ts#L206-L232) - `restartUnderManager`, the restart of a daemon that systemd or launchd holds"
  - "[code://packages/server/src/commands/run.ts#L1328-L1346](../../../../packages/server/src/commands/run.ts#L1328-L1346) - `checkedRestart` as the daemon wires it, with no line check for a supervised daemon"
  - "[code://packages/server/src/commands/plugin.ts#L177-L212](../../../../packages/server/src/commands/plugin.ts#L177-L212) - `plugin.update`, the pattern for an npm install run by the daemon"
  - "[code://packages/server/src/install.ts#L86-L101](../../../../packages/server/src/install.ts#L86-L101) - `launch`, how npm is run on each platform"
  - "[code://packages/server/src/install.ts#L235-L260](../../../../packages/server/src/install.ts#L235-L260) - `fittingVersion`, the newest plugin version whose `@ahpd/sdk` range admits a daemon version"
  - "[code://packages/server/src/install.ts#L306-L311](../../../../packages/server/src/install.ts#L306-L311) - `oneAtATime`, which runs installs and edits one after another"
  - "[code://packages/server/src/install.ts#L700-L712](../../../../packages/server/src/install.ts#L700-L712) - `updatePlugins` stops before npm when a plugin has no fitting version, unless `force`"
  - "[code://packages/server/src/update.ts#L48-L68](../../../../packages/server/src/update.ts#L48-L68) - `newer` and `registry`, the version compare and the registry to ask"
  - "[code://packages/server/src/version.ts#L20-L36](../../../../packages/server/src/version.ts#L20-L36) - `manifest`, which finds the package root of the running daemon"
  - "[code://packages/server/src/commands/scopes.ts#L35-L45](../../../../packages/server/src/commands/scopes.ts#L35-L45) - `checkScopes`, where `deploymentTokenOnly` refuses a person over HTTP"
  - "[code://packages/server/src/commands/registry.ts#L56-L76](../../../../packages/server/src/commands/registry.ts#L56-L76) - `cliRegistry`, where `declareUpdate` goes"
  - "[code://packages/server/src/commands/run.ts#L928-L932](../../../../packages/server/src/commands/run.ts#L928-L932) - `base.methods`, where the usage methods are served and `x-ahpd/update` goes"
  - "[code://packages/sdk/src/types/plugin.ts#L333-L364](../../../../packages/sdk/src/types/plugin.ts#L333-L364) - `PluginMethod`, the shape of an `x-ahpd/` method"
  - "[code://packages/server/package.json](../../../../packages/server/package.json) - `node-pty` is an optional native dependency, which Windows locks while it is loaded"
  - "[code://docs/server/UPGRADE.md](../../../../docs/server/UPGRADE.md) - the upgrade by hand that this command replaces"
  - https://docs.npmjs.com/cli/v11/commands/npm-install - `--prefix`, `-g` and `--allow-scripts`
---

## Goal

`ahpd update` moves the daemon to a newer `@ahpd/server` and restarts it, from the terminal, over HTTP and over AHP.
A desk or a person then updates a daemon with one call and does not need a shell on the machine.
The command installs where ahpd is already installed, moves the plugins to the new SDK, and restarts the daemon as `ahpd restart` does.
It refuses before it installs anything when the result would be a daemon that cannot restart or a plugin that cannot load.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "process.argv\[1\]|import.meta.url" packages/server/src` - the entry of the daemon is used to start and restart it, and `manifest` reads only the name and the version.
- `rg -n "deploymentTokenOnly" packages/server/src` - plugin commands, `paths` and `restart` use it, and `checkScopes` enforces it over HTTP only.
- `rg -n "surfaces:.*ahp|'ahp'" packages/server/src/commands` - no command has an AHP surface.
- `rg -n "EBUSY|EPERM" packages/server/src` - nothing handles a file in use.

### Runtime path

```
ahpd update / POST /api/update / x-ahpd/update
  -> check: registry latest, newer, a running turn, restartable, install place, plugins fit
  -> npm install @ahpd/server@<to> under the install place
  -> plugins moved to @ahpd/sdk@<to>
  -> successorTakes on the new files
  -> answer {from, to, restarting: true}
  -> restart as daemon.restart does (signal, manager, or the Windows helper)
```

### What is true now

- An upgrade is three commands by hand: `npm i -g @ahpd/server`, `ahpd plugin update all` and `ahpd restart`.
- The one-line install of daemon/27 runs `npm install -g`, with the prefix `~/.npm-global` when the global prefix is not writable, and `--allow-scripts=node-pty` on npm 11.16 or later.
- A restart already refuses a daemon in the foreground, accepts one under a service manager, and refuses a running turn unless `force`.
- The new binary is asked whether it takes the recorded line before the old daemon goes down.
- On Linux and macOS a running process does not lock its files, so npm can replace them.
- On Windows, the loaded `node-pty` binding is locked, so npm cannot replace it while the daemon runs.

### Gaps

- `Not found: code that finds where @ahpd/server is installed - searched argv, import.meta.url and prefix in packages/server/src.`
- `Not found: a registry command served as an AHP method - searched surfaces in packages/server/src/commands.`
- No install of the daemon itself, only of plugins.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The command shape: `ahpd update [--version X.Y.Z] [--check] [--force]`, `POST /api/update` and `x-ahpd/update`, with `config:write` and the deployment token only | the desk's request, 2026-10-18 | 02, 04 |
| No `version` means npm latest through `registry()`, and a version that is not newer is refused | the desk's request, 2026-10-18 | 02 |
| `check` answers `{current, latest, may}`, with the refusal in place of `may` when there is one | the desk's request, 2026-10-18 | 02 |
| The install place is found from the path of the running package, and a git checkout or a linked package is refused | Softov, 2026-10-18, chose the recommended answer for "How should `ahpd update` find where ahpd is installed?" | 01 |
| A plugin with no version that admits the new SDK refuses the update unless `force`; after the install, every plugin moves to the new SDK | Softov, 2026-10-18, chose the recommended answer for "What happens when an installed plugin's @ahpd/sdk range does not admit the new version?" | 03 |
| A daemon in the foreground is refused before the install, with the words of `daemon.restart`; a daemon under systemd or launchd is updated | Softov, 2026-10-18, chose the recommended answer for "A daemon run in the foreground cannot restart itself. What should `ahpd update` do with one?" | 02 |
| Windows is in this plan: the install runs after the daemon stops, and a Windows test comes before the merge | Softov, 2026-10-18, chose "Try it in this plan" for "What should `ahpd update` do on Windows?" | 05 |
| `x-ahpd/update` is one method that calls the same update, and no other command gets an AHP surface | Softov, 2026-10-18, chose the recommended answer for "The desk asked for `x-ahpd/update` over AHP. How should it reach AHP?" | 04 |
| On Linux and macOS the answer comes after the install and the plugin move, so an npm failure is the answer | (defaulted: the old daemon still runs when npm fails, so the caller can be told) | 03 |
| On Windows the answer comes before the daemon stops, and a failure after that goes to the daemon log | (defaulted: nothing that answers is running while npm runs) | 05 |
| A supervised daemon checks the new binary with its own argv, because it has no recorded line | (defaulted: a check that is skipped lets a broken install take the unit down) | 03 |
| The Windows helper waits for the daemon to stop for as long as that takes, and logs once after 60 seconds | Softov, 2026-10-19, chose the recommended answer for "What should the Windows helper do when the daemon takes more than 60 s to stop?" | 05 |
| The update runs in `oneAtATime`, with the plugin commands | the desk's request, 2026-10-18 | 02 |

## Proposed architecture

- **Data flow** - `update.ts` in `commands` declares the command. `selfupdate.ts` holds the steps: find the place, plan the versions, install, move the plugins and check the successor.
- **Install place** - `installPlace()` resolves the package root from `manifest`. A root under `<prefix>/lib/node_modules/@ahpd/server` or `<prefix>/node_modules/@ahpd/server` (Windows) is a global install under `<prefix>`. A root under `<dir>/node_modules/@ahpd/server` with `<dir>/package.json` is a prefix install under `<dir>`. Anything else is refused.
- **Restart** - the update hands off to the restart that `daemon.restart` uses, after `successorTakes` passes on the new files.
- **Windows** - the daemon copies a small helper script to a temporary folder and starts it detached. The helper waits for the daemon to exit, runs npm, moves the plugins and starts the daemon with the recorded line.
- **AHP** - `x-ahpd/update` is a `PluginMethod` in `base.methods`. It refuses any owner that is not `root:`, and calls the same steps.
- **Layer responsibilities** - server: the command, the steps, the method and the helper. sdk: nothing.
- **Source-of-truth files** - CREATE: `packages/server/src/selfupdate.ts`, `packages/server/src/commands/update.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The update finds its install place](task-01-the-update-finds-its-install-place.md) | done | - |
| [02 - Update checks and refuses](task-02-update-checks-and-refuses.md) | done | 01 |
| [03 - Update installs, moves the plugins and restarts](task-03-update-installs-moves-plugins-and-restarts.md) | done | 02 |
| [04 - AHP calls the update](task-04-ahp-calls-the-update.md) | done | 03 |
| [05 - Windows installs after the daemon stops](task-05-windows-installs-after-the-daemon-stops.md) | done | 03 |
| [06 - The docs say how to update](task-06-the-docs-say-how-to-update.md) | done | 03, 04, 05 |

## Relations

- **Requires:** daemon/09 for the plugin move and daemon/13 for the restart. Both are built.
- **Blocks:** the update action that ahp-desk calls.
- [daemon/31](../31-the-service-manager-starts-the-daemon/plan.md) - a daemon under its unit restarts through `systemctl --user restart ahpd` after the update.
- [daemon/01](../01-update-check/plan.md) - the update check says a newer version exists, and this command installs it.

## Risks and tradeoffs

- npm fails halfway and leaves files of two versions - `successorTakes` checks the new files first. A broken install keeps the old daemon running.
- A global prefix that needs root - npm refuses, and the answer says the npm error. The update never calls `sudo`.
- `--allow-scripts` is refused on a prefix install by npm 12 - the flag goes only to a global install, as daemon/27 does.
- The Windows helper starts a daemon that does not come up - the helper writes each step to the daemon log. A failed npm starts the old version again.
- A plugin moves to the new SDK while the old daemon runs - the old daemon keeps its loaded modules. The next start loads the moved ones.

## Resume state

- **Done so far:** the plan, 2026-10-18, with Softov's five answers; tasks 01 through 06, 2026-10-19. Every task is implemented and none is reviewed.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:**
`checkScopes` returns early for the `cli` surface, so the deployment token check applies over HTTP only.
`x-ahpd/update` is served by `base.methods` in `run.ts`, and it checks the caller's owner itself, since an AHP method does not pass through `checkScopes`.
The method and the command share `runUpdate()` in `commands/update.ts`.
`successorTakes` runs `process.argv[1]`, which is the same path after the install, with the new files.
A supervised daemon has no recorded line.
`plugin update` pins `@ahpd/sdk` at the running daemon's version, so the update passes the new version.
On Windows the install runs in `updater.ts` after the daemon goes, and the helper may not import this package.
The Windows check by hand is still open in task 05.
`docs/server/UPGRADE.md` keeps the upgrade by hand for an install the update refuses.
Never write `CHANGELOG.md`, which is generated.

## Final verification checklist

- [ ] On Debian, `ahpd update --check` answers the current and the latest version.
- [ ] On Debian, `ahpd update --version <older>` is refused, and `ahpd update` moves a daemon from `ahpd start` and one under the systemd unit.
- [ ] A plugin with no fitting version refuses the update, and `--force` updates and names it.
- [ ] `POST /api/update` with a person's token is refused with 403, and with the deployment token it updates.
- [ ] `x-ahpd/update` from a person is refused, and from the root connection it updates.
- [ ] On Windows, `ahpd update` from `ahpd start` comes back on the new version.
