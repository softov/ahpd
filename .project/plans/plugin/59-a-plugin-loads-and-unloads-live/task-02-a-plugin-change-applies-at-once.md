---
title: A plugin change applies at once
status: done
depends: [task-01-the-host-takes-a-new-fold.md]
layer: "server, docs"
refs:
  - "[code://packages/server/src/plugins.ts#L1156](../../../../packages/server/src/plugins.ts#L1156) - `loadPlugins`, split so one plugin loads or unloads"
  - "[code://packages/server/src/commands/run.ts#L1145](../../../../packages/server/src/commands/run.ts#L1145) - where the daemon keeps what it loaded"
  - "[code://packages/server/src/pluginschannel.ts#L249-L266](../../../../packages/server/src/pluginschannel.ts#L249-L266) - enable and disable"
  - "[code://packages/server/src/pluginschannel.ts#L320-L331](../../../../packages/server/src/pluginschannel.ts#L320-L331) - options"
  - "[code://packages/server/src/rootconfig.ts#L352](../../../../packages/server/src/rootconfig.ts#L352) - a `plugins.` key written through root config"
  - "[code://packages/server/src/commands/plugin.ts#L166-L173](../../../../packages/server/src/commands/plugin.ts#L166-L173) - the restart line of the CLI"
---

## Objective

Enable, disable, options and install load or unload a plugin at once, with no restart.
A plugin with a port or a URI provider still answers `restart: true`.

## Files

- `UPDATE: packages/server/src/plugins.ts:1156` - split `loadPlugins` into `loadOne` for one plugin and `unloadOne`, which runs that plugin's closers.
- `CREATE: packages/server/src/applyplugins.ts` - `applyPlugins`, which compares `config.json` with what is loaded and changes what differs.
- `UPDATE: packages/server/src/commands/run.ts:1145` - keep the base options and the loaded plugins, and pass `applyPlugins` to the channels.
- `UPDATE: packages/server/src/pluginschannel.ts:249-266` - call `applyPlugins` after enable and disable.
- `UPDATE: packages/server/src/pluginschannel.ts:320-331` - call `applyPlugins` after options, and add `x-ahpd/plugins/apply` for the CLI.
- `UPDATE: packages/server/src/rootconfig.ts:352` - call `applyPlugins` after a `plugins.` key is written.
- `UPDATE: packages/server/src/commands/plugin.ts:166-173` - ask a running daemon to apply, in place of the restart line.
- `CREATE: packages/server/test/plugin-live.test.ts` - the cases below.
- `UPDATE: docs/plugins/PLUGINS.md` - say what applies at once, what needs a restart, and that a plugin closes all it opens in a closer.
- `UPDATE: CHANGELOG.md` - one line under the next release.

## Steps

1. Keep each loaded plugin with its name, options, module, contribution and closers.
2. Write `unloadOne(name)`, which runs that plugin's closers and drops its contribution.
3. Write `loadOne(spec)` from the body of `loadPlugins`, and make `loadPlugins` call it for each plugin.
4. Write `applyPlugins`, which reads the plugin list from `config.json`.
5. Make `applyPlugins` unload each plugin that is gone or disabled.
6. Make `applyPlugins` load each plugin that is new or enabled.
7. For new options on a loaded plugin, run its closers and call `apply` again on the same module.
8. Fold the base with every contribution again, and call `host.replace`.
9. Mark a restart and change nothing when a plugin to change has a port or a URI provider.
10. Keep the old fold, and answer the problem, when the fold or `host.replace` refuses the change.
11. Answer `restart: true` from the channel only when `applyPlugins` marked a restart.
12. At the terminal, send `x-ahpd/plugins/apply` to a running daemon.
13. Print the restart line only when the daemon answers `restart: true`.
14. Write the docs section and the changelog line.

## Validation

- `plugin-live.test.ts` enables a plugin with a tool, and an open session gets the tool.
- It disables that plugin, its closer runs, and the tool is gone.
- It changes a plugin's options, and the closer runs before `apply` runs again.
- It disables an adapter plugin, and its connectors show `unavailable`.
- It enables a plugin with a port, and the answer is `restart: true` with nothing loaded.
- `npm test -w packages/server` passes.

## Resume

- **Done so far:** `loadPlugins` in `plugins.ts` is a thin loader over `pluginSet(options)`. The set holds the base, the loaded plugins with their contributions, and the agent list. Its `plan`, `load`, `unload`, `fold` and `settle` are what a change calls. `load` applies one plugin and keeps it. `unload` runs its closers, then drops its contribution. `applyPlugins` in `applyplugins.ts` reads the list from the file. It unloads what the file dropped, loads what it added, and applies again what changed its options. It folds every contribution from the same base and gives the fold to `host.replace`. It answers `restart: true` only for a plugin with a port or a URI scheme, a refused fold, or a `--no-plugins` daemon. `pluginsChannel` runs the apply inside the same `oneAtATime` turn as the write, adds `x-ahpd/plugins/apply`, and answers the apply's `restart`. Root config calls the apply after a `plugins.` key. The daemon in `run.ts` holds the set and re-reads the fold for adapters, trigger types and connects. It refreshes the plugin, adapter and connector lists, and serves routes from the live map. The terminal asks a running daemon to apply after each write: `install`, `remove`, `update`, `enable`, `disable` and `config set`. It prints the restart line only when the daemon answers `restart: true`. `ahpd plugin apply` applies without writing. `plugin-live.test.ts` has the five cases below, and `docs/plugins/PLUGINS.md` has a section named `A change while the daemon runs`.
- **Next action:** [task-03-an-agent-unload-ends-its-sessions.md](task-03-an-agent-unload-ends-its-sessions.md).
- **Files:** `packages/server/src/plugins.ts`, `packages/server/src/applyplugins.ts`, `packages/server/src/commands/run.ts`, `packages/server/src/commands/plugin.ts`, `packages/server/src/commands/served.ts`, `packages/server/src/pluginschannel.ts`, `packages/server/src/rootconfig.ts`, `packages/server/test/plugin-live.test.ts`, `docs/plugins/PLUGINS.md`, this task file, the plan and the index. The session cannot commit, so they are left in the worktree.
- **Open questions:** none.
- **Departures:** The server package has no AHP client. The terminal reaches a running daemon at `POST /api/plugin/apply`, and an AHP client calls `x-ahpd/plugins/apply`. A daemon started with `--no-plugins` answers `restart: true` to every apply. A daemon started with `--plugin` applies the file's list, because the apply reads the file. A fold or a `replace` the host refuses keeps the set loaded, reports the problem and answers `restart: true`. A plugin that loads and then holds a port is unloaded again before the fold, so its closers run. The `ctx.actionTools` gap from task-01 stays: a live adapter change leaves the old adapter tools until a restart.
- **Watch out for:** `applyPlugins` must not take `oneAtATime`, because every caller already holds it and a second turn would wait on itself. The host's options are not the fold the daemon built, because `createHost` spreads it, so the live fold is read from the set again.
