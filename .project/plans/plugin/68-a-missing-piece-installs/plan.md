---
title: A missing Activepieces piece installs when its name is saved
domain: plugin
status: built
priority: medium
created: 2026-10-25
revalidated: 2026-10-25
requires:
  - plans/plugin/67-a-plugin-raises-alerts/plan.md
refs:
  - "[code://packages/activepieces/package.json#L59-L72](../../../../packages/activepieces/package.json#L59-L72) - the 14 pieces that ship as dependencies"
  - "[code://packages/activepieces/package.json#L90-L100](../../../../packages/activepieces/package.json#L90-L100) - the `pieces` pattern, which takes no version"
  - "[code://packages/activepieces/src/plugin.ts#L182-L193](../../../../packages/activepieces/src/plugin.ts#L182-L193) - `apply` asks the child to describe the pieces and reports each error"
  - "[code://packages/activepieces/src/child.ts#L144-L151](../../../../packages/activepieces/src/child.ts#L144-L151) - the child imports each piece by its name"
  - "[code://packages/activepieces/src/child.ts#L170-L180](../../../../packages/activepieces/src/child.ts#L170-L180) - one error line for each piece that does not load"
  - "[code://packages/server/src/plugins.ts#L1165](../../../../packages/server/src/plugins.ts#L1165) - `base`, the plugin's own folder"
  - "[code://packages/server/src/pluginschannel.ts#L540-L548](../../../../packages/server/src/pluginschannel.ts#L540-L548) - how plan 64 runs `npm install --prefix`"
  - "[code://packages/server/src/pluginschannel.ts#L605-L611](../../../../packages/server/src/pluginschannel.ts#L605-L611) - an options write applies at once"
---

## Goal

A person adds a piece name to the Activepieces options and saves.
The piece installs, and its connector shows.
When the install fails, the plugin page says why.
Today a piece must be a dependency in the repository. A piece that is not one fails with a line in the daemon log only.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "import\(" packages/activepieces/src` - the child imports a piece by the name in the options, from the plugin's own `node_modules`.
- `rg -n "'install', '--prefix'" packages/server/src` - plan 64 installs a plugin with npm into a folder it owns.
- `npm view @activepieces/piece-postgres version` - 0.5.1 on 2026-10-25.

### Runtime path

```
x-ahpd/plugins/options write -> reload -> apply -> host.install for each piece that does not resolve -> child describes -> adapters -> alerts on the row
```

### Gaps

- The `pieces` pattern refuses a version.
- No plugin can install a package.
- The child cannot import a piece from any folder but the plugin's own `node_modules`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The install is a host call that a plugin can use | Softov, 2026-10-25: "it could be a host call. avail to the plugin" | 01 |
| A package installs into the plugin's own folder | Softov, 2026-10-25: "the plugin folder" | 01 |
| The folder is `installed/` inside the plugin's folder, with its own `package.json` | (defaulted: a source plugin's folder is in the pnpm workspace, and npm must not change its `node_modules`) | 01 |
| npm runs with `--ignore-scripts`, `--no-audit` and `--no-fund` | (defaulted: a piece install runs no install script) | 01 |
| `host.install(spec)` answers the version it installed, or the npm error | (defaulted) | 01 |
| `host.installed` is the absolute path of that folder | (defaulted: the child resolves a piece from it) | 01 |
| One install runs at a time for a plugin | (defaulted: two npm runs in one folder break each other) | 01 |
| A version is written in the name, as npm takes it: `@activepieces/piece-postgres@0.5.1` | Softov, 2026-10-25 | 02 |
| A name with no version installs the newest version at the time of the install | Softov, 2026-10-25 | 02 |
| The install runs after the person confirms the save | Softov, 2026-10-25 | 02 |
| The install runs in `apply` when the options write reloads the plugin, so the write answers when the install ends | (defaulted: plan 59 reloads a plugin on an options write, and an adapter is registered only in `apply`) | 02 |
| Only a name that does not resolve installs, or a name whose written version is not the one installed | (defaulted) | 02 |
| A piece taken out of the options stays installed | (defaulted) | 02 |
| An install raises an alert with `ref` `piece:<name>`: `info` with the version when it ends, `error` with the npm error when it fails | Softov, 2026-10-25, the alert levels | 02 |
| A piece that still does not load after its install is a `warning` alert with the same `ref` | Softov, 2026-10-25: an item that does not load while the rest do is a `warning` | 02 |
| A piece whose install failed keeps its `error` alert, and gets no load `warning` | (defaulted: a warning with the same `ref` replaces the error, and the npm reason is lost) | 02 |
| A version written for a piece the plugin ships is installed and runs from `installed/` | Softov, 2026-10-25: "Written version wins" | 02 |
| `host.install` refuses a spec that starts with `-`, or holds whitespace, a quote or `%` | (defaulted: a later flag overrides `--ignore-scripts`, and the Windows shell reads those characters) | 01 |

## Proposed architecture

- **Data flow** - `apply` reads the names and installs each missing one through `host.install`. It then asks the child to describe them all, with `host.installed` as a second place to resolve a name.
- **Event flow** - none beyond the plugin reload on an options write.
- **State flow** - the installed packages are on disk in `installed/`, and survive a restart.
- **Layer responsibilities** - sdk: `PluginHost.install` and `installed`. server: the npm run and one install at a time.
  activepieces: the pattern, the version in a name, the install and the alerts. docs: `PLUGINS.md` and the Activepieces README.
- **Source-of-truth files** - [`code://packages/activepieces/src/plugin.ts`](../../../../packages/activepieces/src/plugin.ts), [`code://packages/server/src/plugins.ts`](../../../../packages/server/src/plugins.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A plugin installs a package into its folder](task-01-a-plugin-installs-a-package.md) | done | - |
| [02 - Activepieces installs a missing piece](task-02-activepieces-installs-a-missing-piece.md) | done | 01 |

## Risks and tradeoffs

- A plugin can install any npm package. Plugin code already runs in the daemon, so this adds no power, and `--ignore-scripts` keeps the install itself from running code.
- An options write waits for npm. A slow registry makes the save slow, and the alert says how it ended.
- A piece can depend on a package version that differs from the one in the plugin's own `node_modules`. npm resolves it inside `installed/`.

## Resume state

- **Done so far:** both tasks are implemented. The host has `install(spec)` and `installed`. A plugin's package installs into `installed/` with npm, one at a time. Activepieces reads a version after a piece name, and installs a piece that is missing or not at that version. It asks the child to describe the package names, with `installed` as a second place. Each install and each piece that does not load is an alert under `ref` `piece:<package>`.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** never run npm in the plugin's own folder. For a source plugin that is `packages/activepieces` in the pnpm workspace. The child imports a piece by its name, so a name with a version is cut to the package name before the child sees it. A piece with a version written is imported from `installed/` first when that folder holds the version, also when the plugin ships the piece. A name with no version reads the plugin's own `node_modules` first.

## Final verification checklist

- [ ] In a test daemon, `@activepieces/piece-postgres@0.5.1` saved in the options shows a Postgres connector, and an `info` alert says 0.5.1.
- [ ] A name that is not on npm gives an `error` alert with the npm error, and the other pieces still show.
- [x] `plans/index.md` updated.
