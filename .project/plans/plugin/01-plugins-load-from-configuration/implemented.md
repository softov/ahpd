---
title: Plugins load from configuration and contribute to the host - implemented
date: 2026-09-20
refs:
  - git://3313390
  - code://packages/sdk/src/types/plugin.ts
  - code://packages/sdk/src/plugins.ts
  - code://packages/sdk/src/validate.ts
  - code://packages/sdk/src/version.ts
  - code://packages/server/src/plugins.ts
  - code://packages/server/src/compat.ts
  - code://packages/server/src/config.ts
  - code://packages/server/src/main.ts
  - code://test/plugin-end-to-end.test.ts
  - code://test/plugin-list.test.ts
---

A daemon can now be told about a plugin in `config.json` or with `--plugin`, and what that plugin registers is folded into the one `HostOptions` the daemon hands `createHost`.
A backend, a port or a server tool is an installed package and a configuration line rather than an edit to ahpd and a rebuild, and a plugin that fails costs a line in the log rather than the daemon.
The contract is the option object the daemon already builds, named back, so a plugin author learns nothing new to add a backend.

## What was built

- `code://packages/sdk/src/types/plugin.ts` - `PortKey`, `PortOf`, `PluginSpec`, `PluginContext`, `PluginHost`, `Plugin`, `PortContribution`, `Contribution` and `Loaded`, with no runtime import, so the whole plugin surface is one read.
- `code://packages/sdk/src/plugins.ts` - `foldHostOptions(base, contributions)` returning `{ options, problems }`, `pluginHost(by, context)` returning `{ host, contribution }`, and the exported `AGENT_CLASH` marker a caller refuses over.
- `code://packages/sdk/src/validate.ts` - `miss`, `checkAgent`, `checkTool` and `checkPort`, with `PORT_MEMBERS` and `PORT_METHOD` keyed by `PortKey` so a port added to the union without a checker fails the compiler.
- `code://packages/sdk/src/version.ts` - `sdkVersion()`, read from the nearest `package.json` the way the daemon reads its own.
- `code://packages/server/src/plugins.ts` - `resolvePlugin` and `entryOf`; `readManifest`, `checkManifest` and `checkShape`; `loadOne` and `loadPlugins`; and `describePlugin` and `pluginLine` for the listing.
- `code://packages/server/src/compat.ts` - `satisfies(version, range)` over the update check's own version reader, supporting `*`, an exact version, `^`, `~`, `>=`, `<=`, `>`, `<`, `=` and a two-sided range, and refusing anything else by name.
- `code://packages/server/src/config.ts` - `Config.plugins` and `asSpec`, the one normaliser between a configuration entry and a `PluginSpec`.
- `code://packages/server/src/main.ts` - the old `createHost` literal is `base: HostOptions`, `loadPlugins` runs between `secret` and `createHost`, every problem is stamped, a provider clash exits 1, and the startup lines gain `plugins <names>` and the `plugin list` verb.

## Verified

- `test/plugin-fold.test.ts` - 8 tests: the append order, the base left unmutated, an agent `provider` collision, a plugin against a daemon port, two plugins on one free port, `'replace'` for both, and `sdkVersion()` against `packages/sdk/package.json`.
- `test/plugin-validate.test.ts` - 9 tests: a complete `Agent`, `HostTool` and all nine ports, then the empty and incomplete values for `provider`, `create`, `name`, `run`, `list`, `create` and `chatTitle`, empty `diagnostics`, a probe-less `Agent`, a port registered twice and a repeated provider.
- `test/plugin-resolve.test.ts` - 9 tests: a bare name through the configuration directory, a missing relative path naming both places, a scheme passed through, an uninstalled scoped name, the four manifest entries in order, an entry that escapes its package, the `index.js` fallback and the Deno message.
- `test/plugin-load.test.ts` and `test/plugin-compat.test.ts` - 33 tests: a fixture loaded and folded, a module with no `apply`, a throwing `apply`, a shared `provider`, `enabled: false`, an unresolvable spec, a broken manifest that is never imported, and the range table.
- `test/plugin-spec.test.ts` - 4 tests over `asSpec`.
- `test/plugin-host.test.ts` and `test/plugin-end-to-end.test.ts` - the folded options drive a real host, and the `plugin-echo` fixture is followed from a path spec through a whole turn to the echoed text.
- `test/plugin-list.test.ts` - 9 tests over every listing state, including a module that throws on import still listing as `ready`.
- `pnpm test` green: 45 files, 710 tests; `pnpm typecheck`, `pnpm boundary` and `pnpm build` green.
- By hand: `ahpd --port 0` prints `plugins none`; `--plugin ./test/fixtures/plugin-echo` prints the plugin line and `plugins echo-plugin`; two fixtures with one `provider` print the clash and exit 1; `ahpd plugin list` and its `--plugin`, `--no-plugins` and bad-subcommand forms answer as documented; a WebSocket client that initializes against the daemon with the echo plugin is offered `claude, echo`.
- One flake seen once and not reproduced: two `create-pr` cases in `test/host.test.ts` failed on a full-suite run and passed on the next and in isolation; the plugin changes touch nothing that path uses.

## Departures from the plan

- `Resolved.path` is optional rather than required, because the validation asks for no path on a spec with a scheme of its own and there is nothing to name for one; `Loaded.path` falls back to the URL.
- Task 03's repeated-`provider` scan is the one `foldHostOptions` already performs, so it is reported once by the fold rather than twice.
- The caller that has to refuse over a clash cannot match English, so a clash problem now starts with the exported `AGENT_CLASH`; task 01's test still passes because it asserts on the names inside.
- `checkAgent` checks each optional member by the kind the interface declares, not "each present member is a function", because `description` is a string and `chats` an object; `checkPort` also checks the required `github.resource`, which the plan's shorthand omitted.
- `asSpec` lives in `config.ts` rather than in `main.ts`, because no test starts `main.ts` and the normaliser is the part with a decision in it.
- `describePlugin` returns a `state` and `pluginLine` is exported, both beyond the file list, because the six states are decided where the manifest is read and the line shape is worth pinning without a process.
- The `plugin-echo` fixture imports `../../../examples/echo/agent.ts` rather than `.js`, because Node does not remap the extension at runtime; that needed `allowImportingTsExtensions` in the root checker config, which emits nothing and does not reach the package builds, and the fixture's echo is given `pace: 0` so one turn answers at once.
- The listing is reached as `ahpd plugin list --plugin …`; the plan's by-hand line put the flag before the verb, which the dispatch reads as a run rather than a verb.
- `satisfies` also accepts `>` and `<` beside the named spellings, and pads `0.6` to `0.6.0`, which is what lets `>=0.6 <0.7` be read by the update check's three-number parser.
- Fixtures beyond the plan's list, each for a case that needed one: `plugin-alike`, `plugin-no-peer`, `plugin-plain`, `plugin-configurable`, `plugin-explodes`, `plugin-incompatible/index.ts` and `plugin-bad-manifest/index.js`.

## Left for later

- Customizations, MCP servers, hooks-as-data, a plugin configuration key, host methods, `needs` and `provides`, an installer, hot reload, ports through `Start` and the root configuration schema all wait; see [deferred.md](deferred.md).
- Events are the next plan, [02 - Plugins subscribe to the host's own events](../02-plugins-subscribe-to-host-events/plan.md), which this one does not touch.
