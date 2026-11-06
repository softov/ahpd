---
title: A plugin loads, unloads and reloads while the daemon runs
domain: plugin
status: built
priority: medium
created: 2026-10-23
revalidated: 2026-10-23
requires: []
changes: []
creates: []
refs:
  - "[code://packages/server/src/plugins.ts#L1156](../../../../packages/server/src/plugins.ts#L1156) - `loadPlugins`, which applies every plugin once at start"
  - "[code://packages/server/src/plugins.ts#L1294](../../../../packages/server/src/plugins.ts#L1294) - the one call of `foldHostOptions`"
  - "[code://packages/sdk/src/plugins/plugins.ts#L283-L295](../../../../packages/sdk/src/plugins/plugins.ts#L283-L295) - `foldHostOptions`, which keeps the base's getters so a live value stays live"
  - "[code://packages/sdk/src/host.ts#L156-L203](../../../../packages/sdk/src/host.ts#L156-L203) - `createHost`, which builds the agent map once from the folded options"
  - "[code://packages/sdk/src/host.ts#L805](../../../../packages/sdk/src/host.ts#L805) - a channel is looked up in `options.channels` on each request"
  - "[code://packages/sdk/src/host.ts#L1548](../../../../packages/sdk/src/host.ts#L1548) - a method is looked up in `options.methods` on each request"
  - "[code://packages/server/src/commands/run.ts#L1145](../../../../packages/server/src/commands/run.ts#L1145) - the daemon calls `loadPlugins`"
  - "[code://packages/server/src/commands/run.ts#L1248-L1250](../../../../packages/server/src/commands/run.ts#L1248-L1250) - the daemon builds the host and wires `markRestart`"
  - "[code://packages/server/src/commands/run.ts#L879](../../../../packages/server/src/commands/run.ts#L879) - the pattern: `mcpServers` is a getter, so root config changes it live"
  - "[code://packages/server/src/pluginschannel.ts#L249-L266](../../../../packages/server/src/pluginschannel.ts#L249-L266) - enable and disable write the file and answer `restart: true`"
  - "[code://packages/server/src/pluginschannel.ts#L320-L331](../../../../packages/server/src/pluginschannel.ts#L320-L331) - options write the file and answer `restart: true`"
  - "[code://packages/server/src/rootconfig.ts#L40](../../../../packages/server/src/rootconfig.ts#L40) - `LIVE`, the keys the daemon applies while it runs"
  - "[code://packages/server/src/commands/plugin.ts#L166-L173](../../../../packages/server/src/commands/plugin.ts#L166-L173) - `ahpd plugin install` and `remove` print the restart line"
  - "[code://packages/sdk/src/connectors/channel.ts#L28](../../../../packages/sdk/src/connectors/channel.ts#L28) - a connector whose adapter is gone is already served as `unavailable`"
  - file:///github/ahp-review/briefs/plugin-reload.md - the brief, with the answers this plan builds
---

## Goal

A plugin is loaded, unloaded and reloaded while the daemon runs, as a connector is made or removed today.
Enable, disable, options and install take effect at once, and only a plugin with a port still asks for a restart.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "options\.[a-zA-Z]+" -o packages/sdk/src/host.ts` - channels, methods and events are read from `options` at use; agents are copied into a map once.
- `rg -n "restart" packages/server/src/pluginschannel.ts packages/server/src/commands/plugin.ts` - every plugin change answers `restart: true` or prints the restart line.
- `rg -n "unavailable" packages/sdk/src/connectors` - a connector already shows `unavailable` when its adapter is gone.
- `rg -n "jiti" packages/*/src` - not found. The loader uses `import()`.

### Runtime path

```
enable, disable, options, install -> config.json written -> daemon applyPlugins
  -> diff the config list against the loaded plugins
  -> unload: closers run, contribution dropped
  -> load: import, apply, contracts checked
  -> foldHostOptions(base, contributions) -> host.replace(folded) -> open sessions retooled
  -> a plugin with a port: restart needed, as now
```

### Gaps

- The host reads the folded options once, and has no way to take a second fold.
- The loader closes all plugins at stop, and cannot close one.
- No path loads one plugin after start.
- A second `import()` of the same URL answers the old module.
- `engines` is `node >=22.1`, and Node strips TypeScript by default only from 22.18.

## Answers

| What | Source | Task |
| --- | --- | --- |
| `x-ahpd/plugins/enable`, `disable` and `options` apply at once. They answer `restart: true` only for a plugin that cannot be swapped | Softov, 2026-10-23 | 02 |
| Unloading a plugin with an agent ends the sessions that run on it, then unloads | Softov, 2026-10-23 | 03 |
| `ahpd plugin install` loads the new plugin at once, when it adds no port | Softov, 2026-10-23 | 02 |
| Keep Node's `import()`. A code reload imports a new URL, such as `index.ts?v=2`, and each reload keeps one old copy in memory until a restart. No jiti | Softov, 2026-10-23 | 04 |
| Raise `engines` to `node >=22.18`, where Node strips TypeScript by default, so a `.ts` entry always loads | (defaulted: follows the `import()` answer) | 04 |
| A plugin with a port always needs a restart, for enable, disable and options | Softov, 2026-10-23 | 02 |
| `npm run dev` keeps its `--watch` restart of the whole daemon | Softov, 2026-10-23 | - |
| A live change folds all loaded contributions again from the base, and the host takes the new fold whole. There is no registry for each kind | (defaulted: one path for every kind; the fold already keeps live getters) | 01 |
| A plugin that registers a URI provider needs a restart, as a port does | (defaulted: a session's resources read through it while they run) | 02 |
| New options on the same code run the plugin's closers, then call `apply` again with the module already imported | (defaulted: from the brief, "new options, same code") | 02 |
| One function, `applyPlugins`, reads the plugin list from `config.json` and loads, unloads or applies again what differs | (defaulted: the channel, root config and the CLI all write that file) | 02 |
| At the terminal, `ahpd plugin install`, `remove`, `enable` and `disable` ask a running daemon to apply, in place of the restart line | (defaulted: from the install answer) | 02 |
| A code reload is `x-ahpd/plugins/reload` and `ahpd plugin reload <name>`, and `ahpd plugin update` reloads what it updated | (defaulted: a reload with new code needs a way to ask for it) | 04 |

## Proposed architecture

- **Data flow** - the daemon keeps the base options and one contribution for each loaded plugin. A change edits that list, folds it again, and gives the fold to the host.
- **State flow** - `host.replace(folded)` swaps the options it reads at use, rebuilds the agent map, and retools each open session.
- **Layer responsibilities** - sdk: `host.replace` and the retool. server: `applyPlugins`, the unload, the CLI and the new URL. docs: PLUGINS.md and the changelog.
- **Source-of-truth files** - [`code://packages/server/src/plugins.ts`](../../../../packages/server/src/plugins.ts), [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The host takes a new fold](task-01-the-host-takes-a-new-fold.md) | done | - |
| [02 - A plugin change applies at once](task-02-a-plugin-change-applies-at-once.md) | done | 01 |
| [03 - An agent unload ends its sessions](task-03-an-agent-unload-ends-its-sessions.md) | done | 02 |
| [04 - A code reload imports a new URL](task-04-a-code-reload-imports-a-new-url.md) | done | 02 |

## Risks and tradeoffs

- Each code reload keeps the old module in memory until a restart. The docs say so, and a restart clears it.
- A plugin that keeps a timer or a socket outside its closers keeps it after an unload. The docs say that a plugin closes all it opens in a closer.
- A fold that fails, such as two plugins that claim one name, leaves the old fold in place, and the change answers the problem.

## Resume state

- **Done so far:** task-01, task-02, task-03 and task-04 are implemented. `host.replace(folded)` takes a live fold and refuses one that moves a port or a resource scheme. It keeps an agent that still has a session, and retools every open session. `host.endSessionsOf(agent)` is beside it. `applyPlugins` reads the file, unloads, loads and applies again what differs, folds every contribution from the same base, and gives the fold to the host. The channel, root config and the terminal all apply at once, and only a plugin with a port or a URI scheme answers `restart: true`. An unload ends the sessions on the plugin's agents before its closers run. `x-ahpd/plugins/reload` and `ahpd plugin reload` import a plugin again from `<url>?reload=<count>`, and `ahpd plugin update` reloads what it moved. `wirePlugins` sets every function the host writes on a plugin's entry, at start and again from `replace`, so a live plugin fires, starts and announces. A trigger entry is kept per contribution across folds, so the host's `deliver` survives a second fold.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** `foldHostOptions` copies the base with its property descriptors, so `mcpServers` stays a getter. A second fold must start from the same base object, not from the first fold. Each reload keeps the module it replaced in memory until a restart.

## Final verification checklist

- [ ] With the daemon running, enabling the webhook plugin adds its trigger with no restart.
- [ ] Disabling the Activepieces plugin stops its child process, and its connectors show `unavailable`.
- [ ] A change of Activepieces `pieces` applies at once, and the new adapters show.
- [ ] Disabling an agent plugin ends its sessions.
- [ ] Enabling a plugin with a port answers `restart: true`.
