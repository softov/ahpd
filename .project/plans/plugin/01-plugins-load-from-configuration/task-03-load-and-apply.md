---
title: A plugin module is imported, checked and applied, and a bad one costs a line
status: todo
depends:
  - task-02-resolve-a-spec.md
  - task-08-validate-registrations.md
layer: packages/server
refs:
  - code://packages/server/src/plugins.ts - where `resolvePlugin` already lives and `loadPlugins` joins it
  - code://packages/server/src/version.ts#L20-L37 - the nearest-manifest walk `readManifest` mirrors from a resolved entry
  - code://packages/sdk/src/plugins.ts - `foldHostOptions`, which this task calls with what `apply` produced
  - code://packages/sdk/src/types/plugin.ts - `Plugin`, `PluginHost` and `Contribution`, which the shape check enforces
  - code://.project/decisions/plugin-manifest-is-package-json.md - the `ahpd` key the reader honours and the drift it reports
  - code://.project/ideas/agents-as-extensions.md - a failing plugin is skipped and a duplicate `provider` refuses
  - file:///github/pi/packages/coding-agent/src/core/extensions/loader.ts#L592-L600 - the two messages pi reports, for a module with no factory and a factory that throws
  - code://test/example.test.ts#L1-L30 - the fake `Agent` the loader test contributes
---

## Objective

`loadPlugins(specs, { base, configDir, cwd, log })` turns specs into one folded `HostOptions`: it resolves and imports each, reads the `ahpd` key of the nearest `package.json`, checks that the module named-exports a callable `apply`, builds a `PluginHost` over its contribution, calls `apply` inside a try, and returns the fold, a list of problems and the list of plugins that loaded, with a duplicate `provider` collected as a problem that the caller refuses over.

## Files

- `UPDATE: packages/server/src/plugins.ts` - `readManifest`, `checkShape`, `loadOne`, `loadPlugins`.
- `CREATE: test/fixtures/plugin-hello/package.json` - a fixture manifest with an `ahpd` key, no dependencies.
- `CREATE: test/fixtures/plugin-hello/index.ts` - a fixture plugin exporting `name` and `apply`, contributing one agent and one tool.
- `CREATE: test/fixtures/plugin-broken/index.ts` - a fixture exporting no `apply`.
- `CREATE: test/fixtures/plugin-throws/index.ts` - a fixture whose `apply` throws.
- `CREATE: test/plugin-load.test.ts` - the cases below.

## Steps

1. Write `readManifest(entry: string)`, walking up from the resolved file's directory to the nearest `package.json` exactly as `version.ts` does, parsing only the `ahpd` object and returning `{ name?, title?, entry? }`; return nothing when there is no manifest or no key.
2. Detect the drift decision 2 names: when `ahpd.entry` is present and differs from the file the package would resolve to, push a problem naming both, and load the manifest's entry only when the caller resolved the package rather than a file.
3. Write `checkShape(module, url)` returning a problem when `typeof module.apply !== 'function'`, in pi's words adapted to a named export: `"<url> does not export an apply function"`. Do not consult a default export, and say so in a comment with the reason.
4. Take the host and the contribution from `pluginHost(name, context)` in `@ahpd/sdk` rather than writing the recording rules a second time in the server: the SDK owns what a contribution is and checks every value as it is registered (task 08), and the loader owns only when one is made, so this try is the one failure path for a bad registration.
5. Write `loadOne(resolved, { base, log, version, path, paths })` that imports `resolved.url`, checks the shape, resolves the display name from the module's `name` falling back to the manifest's `name` and then the spec, calls `apply` inside a try, and returns the `Loaded` record or a problem.
6. Catch everything around import and `apply` and turn it into one problem line naming the plugin and the message, because a plugin that throws must not take the daemon with it.
7. Write `loadPlugins(specs, options)` that walks the specs in order, skips a spec with `enabled: false`, records a problem per failure, then appends every contribution's agents and tools and ports, and finally scans `base.agents` plus every contributed agent for a repeated `provider`, reporting one problem per collision naming both parties.
8. Return `{ options, contributions, problems, loaded }` where `options` is `foldHostOptions(base, contributions).options` and `problems` is the concatenation of the plan's and the fold's, so the caller prints once and decides once.
9. Keep the loader free of `process.exit` and of any write, so a test can call it and a verb can report what it found.
10. Write the three fixtures and the test.

## Validation

- `test/plugin-load.test.ts`:
  - the hello fixture loads, `loaded[0].name` is `hello` and `loaded[0].path` is the fixture's absolute path.
  - the folded `options.agents` ends with the fixture's agent, and the folded `options.tools` carries the fixture's tool.
  - the broken fixture produces one problem containing `does not export an apply function`, and every other spec still loads.
  - the throws fixture produces one problem carrying the thrown message, and the process does not reject.
  - two specs contributing the same `provider` produce one problem naming the provider and both plugins.
  - `enabled: false` skips a spec entirely and it appears in neither `loaded` nor `problems`.
  - a spec that does not resolve produces one problem and does not stop the specs after it.
- `pnpm test` green, `pnpm typecheck` green.

## Resume

Empty until started.
