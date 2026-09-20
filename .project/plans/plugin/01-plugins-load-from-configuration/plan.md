---
title: Plugins load from configuration and contribute to the host
domain: plugin
status: active
priority: high
created: 2026-09-20
revalidated: 2026-09-20
requires: []
changes: []
creates: []
decisions:
  - decisions/plugin-contributes-host-options.md
  - decisions/plugin-manifest-is-package-json.md
  - decisions/plugin-contract-lives-in-the-sdk.md
  - decisions/plugin-registration-kinds.md
  - decisions/plugin-compat-is-checked-before-import.md
refs:
  - code://packages/server/src/main.ts#L342-L433 - the `createHost` literal, the one place composition happens today
  - code://packages/server/src/main.ts#L320-L341 - the flow between `parse` and `createHost`, where the fold is inserted
  - code://packages/server/src/main.ts#L135-L211 - `parse()`, where `--plugin` joins and a bad option is refused
  - code://packages/server/src/main.ts#L84-L133 - `USAGE`, which grows the two flags and the `plugin` verb
  - code://packages/server/src/main.ts#L271-L318 - the verbs, which is where `ahpd plugin list` joins
  - code://packages/server/src/config.ts#L8-L41 - `Config`, which gains `plugins`
  - code://packages/server/src/config.ts#L50-L57 - `configDir()`, the directory a bare spec resolves from and where the install happens
  - code://packages/server/src/version.ts#L20-L37 - `manifest()`, the walk up to a nearest `package.json` the manifest reader mirrors
  - code://packages/server/src/update.ts#L28-L68 - `parse` and `newer`, the version comparison a plugin's range is checked with rather than a semver package
  - code://.project/decisions/plugin-compat-is-checked-before-import.md - the manifest check a path spec gets before its code is imported
  - code://packages/sdk/src/types/host.ts#L132-L245 - `HostOptions`, the surface a plugin contributes to and the fold consumes
  - code://packages/sdk/src/types/agent.ts#L158-L300 - `Agent`, whose `provider` is the field a collision refuses over
  - code://packages/sdk/src/index.ts - where `createHost` and the ports are exported, and where the contract and the fold join them
  - code://packages/sdk/src/types/index.ts - the types barrel a `types/plugin.ts` joins, so the contract is importable from the one package a plugin already depends on
  - code://packages/sdk/src/listen.ts#L15-L19 - `runtimeOf()`, the runtime detection the resolver reuses for the Deno case
  - code://scripts/boundary.mjs#L60-L82 - the check that every package declares what it imports, which the SDK's new export does not disturb
  - code://test/example.test.ts#L1-L30 - the fake-peer pattern the end-to-end plugin test reuses
  - code://.project/ideas/plugins.md - the shape this plan implements
  - code://.project/plans/plugin/00-plugin.md - the registration kinds table, of which this plan implements the first three
  - code://.project/ideas/agents-as-extensions.md - the decision that a backend is a configuration key, that a bare spec resolves through `createRequire` against the configuration directory, that a failing plugin is skipped and that a duplicate `provider` refuses
  - file:///github/pi/packages/coding-agent/src/core/pi-manifest.ts - the `package.json` manifest precedent, and the `pi.extensions` key it reads
  - file:///github/pi/packages/coding-agent/src/core/extensions/loader.ts#L592-L600 - how pi reports a module that exports no factory and a factory that throws
  - file:///github/deepseek-harness/packages/sdk/server/src/index.ts#L20-L46 - the named-export plugin shape and the no-default-export rule
  - file:///github/deepseek-harness/packages/boot/plugin-manager/src/install-spec.ts - the spec shapes deepseek-harness accepts, which the resolver's shapes follow
---

## Goal

A person who has installed `@ahpd/server` can add a backend, a port, a server tool or a configuration default by installing a package and naming it in `config.json` or on the command line, with no edit to ahpd and no rebuild.
The daemon still builds exactly one host from `@ahpd/sdk`, and what it now folds in is whatever the plugins it was told about contributed.
The plugin contract is deliberately the option object the daemon already builds, so a plugin author learns nothing new to add a backend, and a plugin that fails costs a line in the log rather than the daemon.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "createHost\(" packages examples test` - one caller in `main.ts`, one per example; the daemon's is the literal this plan folds into, and the examples are the pattern a fixture plugin reuses.
- `rg -n "^function parse|^const options = parse" packages/server/src/main.ts` - `parse` at 135 and applied at 320, so a flag is one `case` and one field on `Options`.
- `rg -n "packages/\*" pnpm-workspace.yaml` - `packages/*` already covers every package, and no new one is added, so the workspace file does not change.
- `rg -n "@ahpd/sdk" tsconfig.json vitest.config.ts` - two alias lists, one for the checker and one for the runner, and neither changes because the contract lands in the package both already name.
- `rg -n "plugin" packages docs` - only the protocol's `Customization.type` vocabulary in `agent-claude` and prose; nothing in ahpd is named a plugin yet.
- `rg -n "readFileSync\(join\(at, 'package.json'" packages` - one reader, `version.ts`, which walks up from its own module to the nearest manifest; the plugin manifest reader does the same from a resolved entry.
- `Not found: any test that starts main.ts - searched "main.js" and "spawn" in test/; the daemon domain says the verbs are covered by hand, so the loader is tested as a function and is not spawned.`
- `Not found: any manifest reader for a package that is not this one - searched "package.json" in packages/server/src; nothing reads another package's manifest.`

### Runtime path

```
ahpd --plugin @ahpd/agent-facio [--no-plugins]
  -> main.ts: parse() reads config.json under the flags, so plugins come from both sources
  -> base: HostOptions built from the literal that is there today
  -> loadPlugins(specs, { configDir, cwd, log })
       -> resolvePlugin(spec) -> import(url) -> readManifest -> apply(host, options)
            each register* checks its value, and a failure fails this plugin only
  -> foldHostOptions(base, contributions) -> one HostOptions
  -> createHost(folded) -> listen()
  -> stdout: `ahpd on ws://...`, `automations ...`, `${from}`, `plugins @ahpd/agent-facio`
```

### Gaps

- `@ahpd/sdk` holds no plugin contract: there is no `Plugin` or `PluginHost` type and no pure fold to test, though every type they are built from is already there.
- Nothing enumerates the kinds a plugin may register: the `PluginHost` sketch in `ideas/plugins.md` shows three and the rest are inferable only from `HostOptions`, which is why decision 4 writes the closed list down.
- `Options` and `Config` have no `plugins` key and `parse()` has no case for `--plugin`, so a plugin can be neither named nor switched off.
- The `createHost` object is built inline, so there is no point between the flags and the host where a contribution can be inserted.
- Nothing turns a spec into something importable, so no rule exists for where an installed package is found or what a bad spec does.
- Nothing reads a plugin's `package.json`, so a plugin cannot be listed without being imported.
- A path spec is neither turned into a file from a directory nor checked against its own manifest, so `--plugin ./some/dir` cannot resolve a directory and an incompatible range is only noticed after the code has run.
- `Not found: a test for a backend that arrives any way but the literal - searched "agents:" in test/; every host test and the example pass their agents directly.`

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A plugin contributes the host's own options, and there is no service container](../../../decisions/plugin-contributes-host-options.md) | Softov, asked 2026-09-20: "A plugin does not register only agents. it could be used to register more things. like resources, store, config, options, hook to sessions, etc." |
| 2 | [The plugin manifest is an `ahpd` key in package.json, and the module is still the contract](../../../decisions/plugin-manifest-is-package-json.md) | Softov, asked 2026-09-20: "Can we use a manifest.json or the package.json as manifest for the plugin?" |
| 3 | [The plugin contract lives in `@ahpd/sdk`, and only the loader is machine-touching](../../../decisions/plugin-contract-lives-in-the-sdk.md) | Softov, asked 2026-09-20: "instead a new package. packages/plugin, would not be better to insert plugin data inside sdk?" |
| 4 | [A plugin registers from a closed set of kinds, one method each](../../../decisions/plugin-registration-kinds.md) | Softov, asked 2026-09-20: "I cant find where is the kinds of registration ... what a plugin can register ... agents, skills, tools, '/' commands, hooks, and what more?" |
| 5 | [A plugin loaded from a path is checked against its own manifest before its code is imported](../../../decisions/plugin-compat-is-checked-before-import.md) | Softov, asked 2026-09-20: "--plugin ./some/dir need to validate plugin manifest.json." |

| What | Source | Task |
| --- | --- | --- |
| `agents` and `tools` concatenate; a singleton port claimed twice is an error naming both unless the later plugin asks for `replace` | decision 1 | 01 |
| What a `register*` is given is checked before it is recorded, and a failed check fails that plugin and not the daemon | decision 4, and doop's `plugin-asserts.ts` | 08 |
| A bare spec resolves through `createRequire` against the configuration directory, so `npm i` there is the install | [agents as extensions](../../../ideas/agents-as-extensions.md) | 02 |
| A plugin that fails to resolve, import or apply is reported and skipped, and a duplicate `provider` refuses at startup naming both | [agents as extensions](../../../ideas/agents-as-extensions.md) | 03, 05 |
| `--plugin` is repeatable and `--no-plugins` switches the whole set off | decision 1, and the flag shape `--path` and `--automations` already use | 04 |
| Compatibility is `peerDependencies` on `@ahpd/sdk`, and no `apiVersion` field is added | decision 2, and deepseek-harness, which has none either | 01 |
| A path spec is checked against its own manifest before its code is imported: a directory resolves through `ahpd.entry`, `exports`, `main` or `index.js`, and a `@ahpd/sdk` range the host does not satisfy is refused | decision 5, and doop's `validatePluginCompat` | 02, 03 |
| Nine kinds are named, three are implemented, and skills, commands, MCP servers and hooks wait on an option rather than on this loader | decision 4, and the domain reference's table | 01, deferred |
| Hooks into a running host are the protocol, and a plugin that wants them is a client | decision 1, Consequences | deferred |

## Proposed architecture

- **Data flow** - specs from `config.json` and then the command line become loaded plugin records, each record's `apply` registers through a `PluginHost` that checks every value before it records it, and the contributions fold into the one `HostOptions` that `createHost` receives.
- **Event flow** - none in this plan, because the loader runs once before the host exists; a plugin that wants events adopts one of the two forms `ideas/plugins.md` records and neither needs a change here.
- **State flow** - none beyond `config.json`; the loader writes nothing, and the only record it consults is the plugin's own `package.json`.
- **Layer responsibilities** - packages/sdk: the contract types in `types/plugin.ts`, the pure `pluginHost` and `foldHostOptions` in `plugins.ts`, and one exported `runtime()` so the resolver reuses the detection `listen.ts` already owns · packages/server/src/plugins.ts: resolution, import, manifest reading, failure policy and `loadPlugins` · packages/server/src/main.ts: what is named, the base options, one call, and the startup line.
- **Source-of-truth files** - `code://packages/sdk/src/types/plugin.ts`, `code://packages/sdk/src/plugins.ts`, `code://packages/server/src/plugins.ts`, `code://packages/server/src/main.ts`, `code://packages/server/src/config.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The contract and the fold](task-01-contract-and-fold.md) | done | - |
| [02 - A spec becomes an importable URL](task-02-resolve-a-spec.md) | done | 01 |
| [03 - A module is imported, checked and applied](task-03-load-and-apply.md) | todo | 02, 08 |
| [04 - The daemon names plugins in configuration and on the command line](task-04-config-and-flags.md) | todo | 01 |
| [05 - The daemon builds its host through the loader](task-05-main-builds-through-the-loader.md) | todo | 03, 04 |
| [06 - A backend arrives by configuration, end to end](task-06-a-backend-arrives-by-configuration.md) | todo | 05 |
| [07 - `ahpd plugin list` reads manifests without importing](task-07-plugin-list.md) | todo | 03 |
| [08 - Every register method checks what it is given](task-08-validate-registrations.md) | todo | 01 |

## Risks and tradeoffs

- A plugin is code in the daemon's process with the daemon's permissions, and there is no sandbox - the configuration file is the trust boundary, so the loader logs the absolute path it imported and the docs say plainly that naming a plugin is running it.
- A relative spec means the working directory decides what runs - the resolver tries the working directory and then the configuration directory, and always logs the resolved absolute path, so what ran is in the log.
- `createRequire` does not exist on Deno - task 02 detects the runtime the way `listen.ts#L15-L19` does, passes `npm:` and URL forms through untouched, and documents that a bare name on Deno is written as `npm:`, rather than pretending one resolver serves all three.
- Node below type-stripping cannot import a `.ts` plugin - the loader imports what it is given and a failure is reported like any other, and the README says to install a built plugin rather than a source one.
- The contract sitting in the SDK means a change to `HostOptions` changes the plugin surface in the same release - which is true of a package of its own too, and is the reason there is not one.
- `daemon.ts` reads the startup lines back with regular expressions, so the plugins line is added as its own line and never folded into the `sessions in` line the parser depends on.
- A plugin can make the daemon refuse to start by colliding on `provider`, which is intended, but it must never do so silently - task 03 collects every collision and reports all of them before the host is built.
- The checkers are hand-written, so one can miss a member a later interface change adds - task 08's test pairs each checker with a complete implementation and with an empty object, so a new required member fails a test rather than reaching a host.
- The range check is hand-written and supports only the spellings it names - an unreadable range is refused by name rather than passed, so the worst case is a plugin that must be spelled differently and not one that loads unchecked.
- A plugin cannot decorate the port it replaces, because `PluginHost` exposes no accessor to what is beneath it - replacing is the whole of what this plan offers, and reading the port beneath is a deferred decision rather than a flag forgotten here.

## Resume state

- **Done so far:** task 01, the contract and the fold, and task 02, the resolver, done 2026-09-20.
- **Next action:** [task-08-validate-registrations.md](task-08-validate-registrations.md).
- **Open questions:**
  1. Does a plugin contribute a root configuration key in this plan - proposed: no, `ROOT_CONFIG_SCHEMA` becomes a `HostOptions` field in a later plan and this one only proves the loading.
  2. Does the contract go in `types/host.ts` or a `types/plugin.ts` of its own - proposed: its own file, so `host.ts` stays the option object and the whole plugin surface is one import.
  3. Does `ahpd plugin list` ship in this plan - proposed: yes as task 07, because it is the only consumer of the manifest decision and the manifest is otherwise unjustified until then.
  4. Can a plugin read the port it is replacing, so that a decorator is possible - proposed: no in this plan, because an accessor is a second kind of contribution and a plugin that replaces is enough to prove the loading.
- **Watch out for:** the `createHost` object is currently built after `await pty()` and before `listen`, so the fold happens there and `loadPlugins` has to be awaited; the base object keeps every existing port so a daemon with no plugins behaves exactly as it does today.
  Another session commits to this checkout, so re-read a file before editing it, stage explicit paths, and refuse to sweep its work into yours; the `code://` line anchors were last checked 2026-09-20 and a moved line is worth re-finding rather than trusting.

## Final verification checklist

- [ ] `pnpm test` green, with the fold, resolver, loader and end-to-end plugin cases in it.
- [ ] `pnpm typecheck`, `pnpm boundary` and `pnpm schema` green.
- [ ] By hand: `ahpd --plugin <fixture>` serves the contributed backend, and `ahpd` with no plugins serves exactly what it does today.
- [ ] By hand: a spec that does not resolve, a module that throws and a duplicate `provider` each say what happened without the daemon dying, except the collision, which refuses.
- [ ] By hand: `--plugin ./fixture` with a `@ahpd/sdk` range the daemon does not satisfy is refused before its entry runs, and `ahpd plugin list` reports it as `incompatible`.
- [ ] `docs/DAEMON.md` and the README name the `plugins` key and the two flags.
- [ ] `plans/index.md` and `plans/daemon/00-daemon.md` updated.
