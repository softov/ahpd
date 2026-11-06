---
title: A client lists the plugins
status: done
depends: [task-01-the-manifest-is-read.md]
layer: "server"
refs:
  - "[code://packages/server/src/plugins.ts#L1197-L1240](../../../../packages/server/src/plugins.ts#L1197-L1240) - `PluginRow` and `describePlugin`"
  - "[code://packages/server/src/commands/plugin.ts#L238-L438](../../../../packages/server/src/commands/plugin.ts#L238-L438) - `configure` and `toggle`, what the methods call"
  - "[code://packages/server/src/install.ts#L467](../../../../packages/server/src/install.ts#L467) - `setPluginEnabled`"
  - "[code://packages/server/src/commands/run.ts#L632-L647](../../../../packages/server/src/commands/run.ts#L632-L647) - `servedRecords('ahpd', ...)`"
  - "[code://packages/sdk/src/resources/recordschannel.ts#L72](../../../../packages/sdk/src/resources/recordschannel.ts#L72) - `recordsChannel`"
---

## Objective

A client subscribes to `x-ahpd-plugins` and gets one row for each configured plugin.
A row has the id, the package, the title, the state, the problem, the manifest and `undeclared` when it has no contracts.
A client calls `x-ahpd/plugins/enable`, `disable` and `options`, and the configuration file changes as `ahpd plugin` changes it.

## Files

- `CREATE: packages/server/src/pluginschannel.ts` - the channel and the three methods.
- `UPDATE: packages/server/src/commands/run.ts:632-647` - add the channel and the methods to `servedRecords`.
- `CREATE: packages/server/test/plugins-channel.test.ts` - the cases below.

## Steps

1. Build each row from `describePlugin`, and add the manifest of the loaded plugin.
2. Mask each option that root configuration masks, with the same code.
3. Serve the rows with `recordsChannel('x-ahpd-plugins', ...)`, keyed by the plugin id.
4. Give read access with the grant `config:read`.
5. Make `enable` and `disable` call `setPluginEnabled`, with the grant that `ahpd plugin enable` needs.
6. Make `options` write one option with the writer that `ahpd plugin set` uses.
7. Answer each method with `restart: true` when the command line answers it.
8. Publish the changed row after each method.
9. Run the server plugin tests, and set this task and the plan row to `done`.

## Validation

- `plugins-channel.test.ts`: two configured plugins give two rows, one with its manifest.
- `plugins-channel.test.ts`: `disable` sets the entry off in the configuration file, and the row says so.
- `plugins-channel.test.ts`: an option written as a `$secret` shows masked in the row.
- `plugins-channel.test.ts`: the host refuses a caller with no grant.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass.

## Resume

- **Done so far:** `packages/server/src/pluginschannel.ts` builds the channel and the three commands. A row is the row of `describePlugin`, with the spec masked by `withoutSpecSecrets`. Every string that can hold a URL passes through `withoutUserinfoIn`. The row carries the manifest of the loaded plugin, and `undeclared: true` when that manifest has no `contracts`. `x-ahpd-plugins` needs `config:read`, and its rows are keyed by the plugin id. `x-ahpd/plugins/enable`, `disable` and `options` need `config:write`. Each command runs inside `oneAtATime` and writes through `setPluginEnabled` or `setPluginOption`. It then refreshes the channel, so the changed row is published, and answers `restart: true`. `run.ts` builds the channel beside the people and policy channels and gives it to `servedRecords`. The channel is built before `loadPlugins` runs, so it reads the loaded plugins through a closure that the load fills in. `plugins-channel.test.ts` has the four cases the Validation names. It also has one for writing an option and one for a value the plugin's schema refuses.
- **Departures:** `x-ahpd/plugins/options` takes `{ id, key, value }`. A `value` left out removes the option, through the writer that `plugin config unset` uses. The step named only the write, but one method carries both so a client can clear an option. The method checks the value against the plugin's own schema, as `plugin config set` does, and refuses with `-32602`. For a plugin that is switched off or does not import, it writes the value unchecked, as the command does. The mask uses the schema the daemon holds for a loaded plugin (`optionsSchemaLoaded`), and falls back to `optionsSchemaOf`. The masking itself is the `withoutSpecSecrets` that serves `plugin list`. Every method answers `restart: true` and does not read `running()`. Only a running daemon serves this channel, and on that path `ahpd plugin` also answers `restart`. Two entries with one id are listed once, and `onProblem` reports the second. A records channel is keyed by id, and the loader refuses the second entry at start.
- **Fixed in review:** a spec that does not resolve is its own id. A URL spec with userinfo therefore listed its token in the id of its row. `idOf` and the row's id now pass through `withoutUserinfoIn`, and a sixth case in `plugins-channel.test.ts` holds it.
- **Next action:** tasks 07 to 09 follow (07 needs 05 and 06); this session stops after 04.
- **Open questions:** none.
- **Watch out for:** `oneAtATime` guards the configuration file in `commands/plugin.ts`, and the methods use it too. A client and a terminal therefore never read and write the file over each other. A plugin disabled while the daemon runs keeps the manifest it loaded with. A plugin disabled before the start shows none, as the plan's risk note says. The channel does not watch the file. A subscriber sees a hand edit at the next method or the next subscribe.
- **Commit:** not made in the session (`git add` is denied here). Files: `packages/server/src/pluginschannel.ts` (new), `packages/server/src/commands/run.ts`, `packages/server/test/plugins-channel.test.ts` (new), this task file and the plan row.
