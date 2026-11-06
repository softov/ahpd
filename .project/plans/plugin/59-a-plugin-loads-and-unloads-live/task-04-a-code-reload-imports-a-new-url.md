---
title: A code reload imports a new URL
status: done
depends: [task-02-a-plugin-change-applies-at-once.md]
layer: "server, docs"
refs:
  - "[code://packages/server/src/plugins.ts#L1156](../../../../packages/server/src/plugins.ts#L1156) - the loader that calls `import()`"
  - "[code://packages/server/src/pluginschannel.ts#L249-L266](../../../../packages/server/src/pluginschannel.ts#L249-L266) - the pattern for a new channel command"
  - "[code://packages/server/src/commands/plugin.ts](../../../../packages/server/src/commands/plugin.ts) - `ahpd plugin`, which gets `reload`"
---

## Objective

A reload with new code imports the plugin from a new URL, so the new files load with no restart.
Each reload keeps the old module in memory until a restart, and the docs say so.

## Files

- `UPDATE: packages/server/src/plugins.ts` - add a reload count to each plugin, and import `<url>?v=<count>`.
- `UPDATE: packages/server/src/pluginschannel.ts` - add `x-ahpd/plugins/reload`, which takes `{ id }`.
- `UPDATE: packages/server/src/commands/plugin.ts` - add `ahpd plugin reload <name>`, and reload after `ahpd plugin update`.
- `UPDATE: package.json` - raise `engines.node` to `>=22.18`.
- `UPDATE: packages/server/test/plugin-live.test.ts` - the reload case.
- `UPDATE: docs/plugins/PLUGINS.md` - the reload command and the memory it keeps.
- `UPDATE: CHANGELOG.md` - the reload command and the new Node version.

## Steps

1. Count the reloads of each plugin, from 0 at start.
2. Import `<url>?v=<count>` when the count is above 0.
3. Write the reload as `unloadOne`, then a count increase, then `loadOne`.
4. Add `x-ahpd/plugins/reload`, which answers `restart: true` for a plugin with a port, as task 02 does.
5. Add `ahpd plugin reload <name>`, which sends the request to the running daemon.
6. Make `ahpd plugin update` reload each plugin that it updated.
7. Raise `engines.node` to `>=22.18` in the root `package.json`.
8. Write the docs and the changelog lines.

## Validation

- `plugin-live.test.ts` loads a plugin file, rewrites the file, reloads, and the new code answers.
- `npm test -w packages/server` passes.
- `npm run typecheck` passes.

## Resume

- **Done so far:** `namePlugin` takes a reload count and imports `<url>?reload=<count>` above zero. `loadOne` passes the count, and `pluginSet` keeps one per plugin in `counts`. `reload(entry)` raises the count, then loads. `applyPlugins` takes `reload: string[]`, matches a name against the id or the spec, and ends the sessions before the unload. It reports a name the file lacks, or one switched off. A missing name also asks for a restart, since only a restart loads a package a plugin uses. A forced reload of a plugin with a port answers `restart: true` and changes nothing. `x-ahpd/plugins/reload` takes `{ id }` and needs `plugin:reload`. `ahpd plugin reload <name>` asks the recorded daemon over `POST /plugin/reload`, and `ahpd plugin update` reloads each package it moved. The root `engines` is `>=22.18`. The test rewrites a plugin module, reloads it, and the session gets the new tool. It also checks a name absent from the file. The docs have the command and the memory it keeps.
- **Next action:** the plan's tasks are implemented; run the final verification checklist before the plan moves on.
- **Files:** `packages/server/src/plugins.ts`, `packages/server/src/applyplugins.ts`, `packages/server/src/pluginschannel.ts`, `packages/server/src/commands/run.ts`, `packages/server/src/commands/served.ts`, `packages/server/src/commands/plugin.ts`, `packages/server/test/plugin-live.test.ts`, `packages/server/test/server-commands.test.ts`, `package.json`, `docs/plugins/PLUGINS.md`, this task file, the plan and the index. The session cannot commit, so they are left in the worktree.
- **Open questions:** none.
- **Departures:** The URL says `?reload=<count>` rather than `?v=<count>`. Vite reads `?v=` as its own dependency cache key and drops it, so a reload under the test runner imported the old module. `CHANGELOG.md` is left alone, because a generated file is not edited here. The task named only the root `engines`. The floor also moved to 22.18 in `packages/server/package.json`, the install scripts, the `ahpd configure` check and the install docs, so the published package and the installers ask for the same Node.
- **Watch out for:** The runtime keeps each replaced module until a restart, so a long development loop grows. `ahpd plugin update` reloads the package names, which match a spec written as that package or an entry with that id.
