---
title: A plugin module is validated, imported, checked and applied, and a bad one costs a line
status: todo
depends:
  - task-02-resolve-a-spec.md
  - task-08-validate-registrations.md
layer: packages/server
refs:
  - code://packages/server/src/plugins.ts - where `resolvePlugin` already lives and `loadPlugins` joins it
  - code://packages/server/src/version.ts#L20-L37 - the nearest-manifest walk `readManifest` mirrors from a resolved entry
  - code://packages/server/src/update.ts#L28-L68 - `parse`, which `satisfies` in `compat.ts` is built on rather than a second parser
  - code://.project/decisions/plugin-compat-is-checked-before-import.md - the check and why it is before `import()`
  - code://.project/decisions/plugin-manifest-is-package-json.md - the `ahpd` key the reader honours and the drift it reports
  - code://packages/sdk/src/version.ts - `sdkVersion()`, the version a plugin's range is checked against
  - code://packages/sdk/src/plugins.ts - `foldHostOptions`, which this task calls with what `apply` produced
  - code://packages/sdk/src/types/plugin.ts - `Plugin`, `PluginHost` and `Contribution`, which the shape check enforces
  - code://.project/ideas/agents-as-extensions.md - a failing plugin is skipped and a duplicate `provider` refuses
  - file:///github/pi/packages/coding-agent/src/core/extensions/loader.ts#L592-L600 - the two messages pi reports, for a module with no factory and a factory that throws
  - code://test/example.test.ts#L1-L30 - the fake `Agent` the loader test contributes
---

## Objective

`loadPlugins(specs, { base, configDir, cwd, log })` turns specs into one folded `HostOptions`: for each it reads the manifest, refuses a malformed or incompatible one **before** importing anything, imports the entry, checks that the module named-exports a callable `apply`, builds a `PluginHost` over its contribution, calls `apply` inside a try, and returns the fold, a list of problems and the list of plugins that loaded, with a duplicate `provider` collected as a problem that the caller refuses over.

## Files

- `UPDATE: packages/server/src/plugins.ts` - `readManifest`, `checkManifest`, `checkShape`, `loadOne`, `loadPlugins`.
- `CREATE: packages/server/src/compat.ts` - `satisfies(version, range)` over the parse `update.ts` already has.
- `UPDATE: packages/server/src/update.ts:28-L45` - export `parse` so `compat.ts` reuses it rather than writing a second one.
- `CREATE: test/fixtures/plugin-hello/package.json` - a fixture manifest with an `ahpd` key and a satisfied `peerDependencies`, no dependencies to install.
- `CREATE: test/fixtures/plugin-hello/index.ts` - a fixture plugin exporting `name` and `apply`, contributing one agent and one tool.
- `CREATE: test/fixtures/plugin-broken/index.ts` - a fixture exporting no `apply`.
- `CREATE: test/fixtures/plugin-throws/index.ts` - a fixture whose `apply` throws.
- `CREATE: test/fixtures/plugin-incompatible/package.json` - a fixture declaring a `@ahpd/sdk` range the running SDK does not satisfy, whose entry throws when imported.
- `CREATE: test/fixtures/plugin-bad-manifest/package.json` - a fixture whose `package.json` does not parse.
- `CREATE: test/plugin-load.test.ts` and `CREATE: test/plugin-compat.test.ts` - the cases below.

## Steps

1. Write `readManifest(packageDir)` reading `packageDir/package.json` once and returning `{ name?, title?, entry?, sdkRange?, problem? }`, so the loader reads the file once and both checks use the same parse.
2. Write `checkManifest(manifest, packageDir)` returning a problem for: a `package.json` that does not parse; an `ahpd` that is not an object; an `ahpd.entry` that is not a string or that resolves outside `packageDir`; a `peerDependencies["@ahpd/sdk"]` that is present and not a string.
3. Write `satisfies(version, range)` in `compat.ts` over the `parse` that `update.ts` already has, supporting `*`, an exact version, `^`, `~`, `>=`, `<=` and a two-sided space-separated range; refuse an unreadable range by name rather than passing it.
4. In `loadOne`, check the manifest first and, when it names a `@ahpd/sdk` range, call `satisfies(sdkVersion(), range)` and refuse with a message naming the range, the version in use and the plugin, **before** `import()` is reached, so an incompatible plugin is never executed.
5. Detect the drift decision 2 names: when `ahpd.entry` is present and differs from the file the package resolved to, push a problem naming both, and load the manifest's entry only when the caller resolved the package rather than a file.
6. Write `checkShape(module, url)` returning a problem when `typeof module.apply !== 'function'`, in pi's words adapted to a named export: `"<url> does not export an apply function"`. Do not consult a default export, and say so in a comment with the reason.
7. Take the host and the contribution from `pluginHost(name, context)` in `@ahpd/sdk` rather than writing the recording rules a second time in the server: the SDK owns what a contribution is and checks every value as it is registered (task 08), and the loader owns only when one is made, so this try is the one failure path for a bad registration.
8. Write `loadOne(resolved, { base, log, version, path, paths })` that reads and checks the manifest, checks the range, imports `resolved.url`, checks the shape, resolves the display name from the module's `name` falling back to the manifest's `name` and then the spec, calls `apply` inside a try, and returns the `Loaded` record or a problem.
9. Catch everything around import and `apply` and turn it into one problem line naming the plugin and the message, because a plugin that throws must not take the daemon with it.
10. Write `loadPlugins(specs, options)` that walks the specs in order, skips a spec with `enabled: false`, records a problem per failure, then appends every contribution's agents and tools and ports, and finally scans `base.agents` plus every contributed agent for a repeated `provider`, reporting one problem per collision naming both parties.
11. Return `{ options, contributions, problems, loaded }` where `options` is `foldHostOptions(base, contributions).options` and `problems` is the concatenation of the plan's and the fold's, so the caller prints once and decides once.
12. Keep the loader free of `process.exit` and of any write, so a test can call it and a verb can report what it found.
13. Write the fixtures and the two tests.

## Validation

- `test/plugin-load.test.ts`:
  - the hello fixture loads, `loaded[0].name` is `hello` and `loaded[0].path` is the fixture's absolute path.
  - the folded `options.agents` ends with the fixture's agent, and the folded `options.tools` carries the fixture's tool.
  - the broken fixture produces one problem containing `does not export an apply function`, and every other spec still loads.
  - the throws fixture produces one problem carrying the thrown message, and the process does not reject.
  - two specs contributing the same `provider` produce one problem naming the provider and both plugins.
  - `enabled: false` skips a spec entirely and it appears in neither `loaded` nor `problems`.
  - a spec that does not resolve produces one problem and does not stop the specs after it.
  - the bad-manifest fixture produces one problem naming the file, and no `import()` of it is attempted.
- `test/plugin-compat.test.ts`:
  - `satisfies('0.6.0', '^0.6.0')` is true; `satisfies('0.7.0', '^0.6.0')` is false; `satisfies('0.6.5', '>=0.6 <0.7')` is true; an exact, `~`, `*` and a `<=` case each pass; `satisfies('0.6.0', 'banana')` is refused by name.
  - the incompatible fixture produces one problem naming the range and the version, and its entry is never imported, pinned with a module-level flag the fixture sets and the test asserts is unset.
  - a fixture with no `peerDependencies` loads, because absent is not incompatible.
- `pnpm test` green, `pnpm typecheck` green.

## Resume

Empty until started.
