---
title: `ahpd plugin list` reads manifests without importing
status: todo
depends:
  - task-03-load-and-apply.md
layer: packages/server
refs:
  - code://packages/server/src/main.ts#L271-L318 - the verb dispatch, where `plugin` joins beside `stop`, `status` and `config`
  - code://packages/server/src/plugins.ts - `resolvePlugin` and `readManifest`, which the listing uses and the loader shares
  - code://packages/server/src/main.ts#L84-L133 - `USAGE`, which gains the verb
  - code://.project/decisions/plugin-manifest-is-package-json.md - the listing is the reason the `ahpd` key exists at all
  - file:///github/doop/pood/src/providers/plugins/plugin-loader.ts#L133-L150 - the loader states (`loaded` / `unconfigured` / `error` / `offline` / `disabled`) this listing adapts
  - file:///github/doop/plugins/STRUCTURE.md - the same states written down for a person
---

## Objective

`ahpd plugin` lists every plugin the configuration names, resolveable and not, with a state, the path each spec resolves to, and the name and title its manifest declares, and it does so without importing any plugin, so what a run would load, what it cannot find, what needs configuring and what is switched off are one screen read before anything runs.

## Files

- `UPDATE: packages/server/src/plugins.ts` - `describePlugin(spec, { configDir, cwd }): Promise<PluginRow>` where `PluginRow` is `{ spec, url?, path?, name?, title?, problem? }` and nothing is imported.
- `UPDATE: packages/server/src/main.ts:271-318` - the `plugin` verb, the `list` subcommand and its lines.
- `UPDATE: packages/server/src/main.ts:84-133` - `USAGE`, the verb and its one subcommand.
- `CREATE: test/plugin-list.test.ts` - the rows.

## Steps

1. Write `describePlugin` as resolve, then read the manifest from the resolved path, and nothing else: no `import`, no `apply`, so a plugin that would throw on load still lists.
2. Return a row per spec with `problem` set to the resolver's message when the spec does not resolve, so a bad entry is visible in the listing rather than only at startup.
3. Add the `plugin` verb to the dispatch, answering `No command called plugin` is not enough: accept `list` and refuse anything else with `plugin takes list`.
4. Print one line per spec as `<state> <spec> -> <path> (<name>, <title>)`, using the manifest name and never importing, with the states doop's loader uses adapted to a command that does not load: `ready` for a spec that resolves and whose manifest parses, `incompatible` where `peerDependencies["@ahpd/sdk"]` is a range the running SDK does not satisfy, `unconfigured` where the manifest's `ahpd.options` names a required key the configuration does not set, `disabled` for `enabled: false`, `missing` where the spec does not resolve, and `error` where the manifest does not parse. `incompatible` is the same check task 03 gates on, run here for its answer rather than for a refusal, which is why it needs no import either.
5. Read the plugins from the same `parse(argv)` the run uses, so a `--plugin` on the listing command lists what that command line would load, and `--no-plugins` lists nothing with a line saying so.
6. Keep the verb free of `createHost` and of listening, so it cannot accidentally start a daemon.

## Validation

- `test/plugin-list.test.ts`:
  - a fixture package with an `ahpd` key lists its path, name and title.
  - the hello fixture with no `ahpd` key lists its path and package `name` with no title.
  - a single-file spec with no manifest lists `(no manifest)`.
  - a spec that does not resolve lists its problem and no path.
  - a plugin whose `index.ts` throws on import still lists as `ready`, because nothing imported it.
  - a spec marked `enabled: false` lists as `disabled`.
  - a manifest naming a required option the configuration does not set lists as `unconfigured`.
  - a manifest whose `@ahpd/sdk` range the running SDK does not satisfy lists as `incompatible`, and its entry is not imported.
- By hand: `ahpd plugin list` and `ahpd --plugin ./test/fixtures/plugin-echo plugin list`.
- `pnpm test` green, `pnpm typecheck` green.

## Resume

Empty until started.
