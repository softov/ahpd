---
title: An admin installs and removes a plugin from the UI
domain: plugin
status: built
priority: medium
created: 2026-10-25
revalidated: 2026-10-25
requires:
  - plans/plugin/59-a-plugin-loads-and-unloads-live/plan.md
refs:
  - "[code://packages/server/src/install.ts#L622-L657](../../../../packages/server/src/install.ts#L622-L657) - `installPlugins`, which takes npm package names only"
  - "[code://packages/server/src/install.ts#L815-L836](../../../../packages/server/src/install.ts#L815-L836) - `removePlugins`, which edits the file and then runs `npm uninstall`"
  - "[code://packages/server/src/commands/plugin.ts#L220-L275](../../../../packages/server/src/commands/plugin.ts#L220-L275) - `ahpd plugin install` and `remove`, and their HTTP routes, which only the deployment token may call"
  - "[code://packages/server/src/commands/scopes.ts#L14-L27](../../../../packages/server/src/commands/scopes.ts#L14-L27) - `deploymentTokenOnly`, and why no grant a person holds confers it"
  - "[code://packages/server/src/pluginschannel.ts#L368-L419](../../../../packages/server/src/pluginschannel.ts#L368-L419) - `apply` and `reload`, the pattern for a new command"
  - "[code://packages/server/src/plugins.ts#L233-L248](../../../../packages/server/src/plugins.ts#L233-L248) - a path in the `plugins` list loads as written"
  - "[code://packages/sdk/src/access/users.ts#L26-L35](../../../../packages/sdk/src/access/users.ts#L26-L35) - the built-in roles, where only `admin` holds `*:*`"
  - "[code://docs/plugins/PLUGINS.md#L1222-L1224](../../../../docs/plugins/PLUGINS.md#L1222-L1224) - the table of plugins channel commands"
  - file:///github/ahp-review/briefs/plugin-from-the-ui.md - the brief this plan comes from
---

## Goal

An admin installs and removes a plugin on a running daemon from a client, as `ahpd plugin install` does from the terminal.
The source is an npm package, a GitHub repository, an ssh git repository, a URL or a file.
An admin can also write a plugin as one TypeScript file in the client.
The ahpw page for this is a plan in ahpw, after this one.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `git grep -n "deploymentTokenOnly"` - the HTTP install, remove, update, options and restart commands refuse every person.
- `git grep -n "plugin:reload"` - an AHP plugin command checks only its grant, so an admin can already reload plugin code.
- A test on Node 24.19.0, on 2026-10-25: a `.ts` file in `<config>/plugins/hello/` that imports `@ahpd/sdk` loads. The same file under `node_modules` fails with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`.
- `installPlugins` always installs `@ahpd/sdk` at the daemon's version into the plugin root, so a file below that root resolves it.

### Runtime path

```
client -> x-ahpd/plugins/install -> grant plugin:install -> install path (npm) -> config.json plugins -> applyPlugins -> plugins channel row
```

### Gaps

- `installPlugins` refuses every source that is not a package name.
- The plugins channel has no command that adds or removes a plugin.
- Nothing writes a plugin file for a client, or reads its text back.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A plugin from the UI comes from the same sources as one from the CLI: npm, GitHub, a URL, a file and ssh | Softov, 2026-10-24: "a plugin added like today. npm, github, url, file, ssh, etc." | 01 |
| One install path takes every source, and `ahpd plugin install` and the channel command both call it | Softov, 2026-10-24: "Add to both" | 01 |
| npm installs every source, because it already takes `github:`, `git+ssh:`, a tarball URL and a path | (defaulted: one tool for every source) | 01 |
| The name the `plugins` list gets is the dependency that npm adds to the plugin root's `package.json` | (defaulted: a git or URL source has no name before npm reads it) | 01 |
| A package with no `ahpd` field is uninstalled again and refused | (defaulted: the registry check refuses one before npm runs) | 01 |
| A new grant, `plugin:install`, installs and removes a plugin, and only `admin` holds it | Softov, 2026-10-25: "Admin, over AHP and HTTP" | 02 |
| `POST /plugin/install` and `/plugin/remove` take `plugin:install` in place of the deployment token | Softov, 2026-10-25: "Admin, over AHP and HTTP" | 02 |
| `ahpd plugin update`, options and restart stay with the deployment token | (defaulted: only install and remove were asked) | 02 |
| The command answers when npm ends, then applies as `applyPlugins` does, with `restart: true` for a plugin with a port | (defaulted: follows plan 59) | 02 |
| The new plugin lists on the plugins channel with every other plugin | Softov, 2026-10-24: "same plugin list channel" | 02 |
| A plugin written in the UI is a folder with the file and a `package.json` the admin edits, and the daemon runs `npm install` in it | Softov, 2026-10-24: "A package.json with it" | 03 |
| The folder is `<plugin root>/plugins/<id>/`, outside `node_modules`, and the `plugins` list names its path | (defaulted: Node refuses to strip types under `node_modules`) | 03 |
| A plugin written in the UI may import a package that is not part of ahpd | Softov, 2026-10-24: "maybe, useful" | 03 |
| Every admin can read the text of a plugin written in the UI, with `x-ahpd/plugins/source` | Softov, 2026-10-24: "yes, another admin can read it" | 03 |
| A remove of a written plugin deletes its folder, unless the remove keeps it | (defaulted: as `npm uninstall` deletes an installed package) | 03 |

## Proposed architecture

- **Data flow** - a source goes to the one install path, npm installs it into the plugin root, and the path writes its name into `config.json`.
- **State flow** - `applyPlugins` loads what the file now names, and the plugins channel publishes the new row.
- **Layer responsibilities** - server: the install path, the channel commands, the HTTP grant and the written plugin folder. docs: PLUGINS.md.
- **Source-of-truth files** - [`code://packages/server/src/install.ts`](../../../../packages/server/src/install.ts), [`code://packages/server/src/pluginschannel.ts`](../../../../packages/server/src/pluginschannel.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - One install path takes every source](task-01-one-install-path-takes-every-source.md) | done | - |
| [02 - The plugins channel installs and removes](task-02-the-channel-installs-and-removes.md) | done | 01 |
| [03 - An admin writes a plugin in the UI](task-03-an-admin-writes-a-plugin.md) | done | 02 |

## Risks and tradeoffs

- `plugin:install` gives the daemon's permissions, because a plugin runs with them - only `admin` holds it, and task 02 says so in `scopes.ts`.
- npm 12 runs no install script in the plugin root, so a git source is not built - PLUGINS.md says to ship the build or `.ts`.
- An ssh git source uses the daemon user's ssh key and `known_hosts` - the error from npm is shown as it is.
- An install can take minutes, and the client waits for the answer - the channel row says nothing new until the install ends.

## Resume state

- **Done so far:** tasks 01, 02 and 03 are implemented. Typecheck, build and boundary pass. The tests pass except five timeouts that also fail on main: four in `packages/computer/test/` and one in `packages/sdk/test/nested-start.test.ts`. A review found six things, and each fix has its own test. A `--stdio` daemon writes every problem to stderr, and the plugins channel drops npm progress lines. A write stages into `<plugin root>/plugins/.<id>.new/` and swaps in only when npm succeeds. A source whose package landed no manifest is uninstalled and refused. A source or a removed name that starts with `-` is refused before npm runs, and npm gets every name after `--`. `x-ahpd/plugins/install` answers the row's own id after the apply.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** a written plugin must never go under `node_modules`, because Node refuses to strip its types there.
