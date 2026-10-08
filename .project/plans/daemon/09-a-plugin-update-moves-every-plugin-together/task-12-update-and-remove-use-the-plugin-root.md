---
title: Update and remove use the plugin root, and an sdk move asks for a restart
status: done
depends: [task-11-update-answers-what-moved.md]
layer: "server"
refs:
  - "[code://packages/server/src/install.ts#L312-L325](../../../../packages/server/src/install.ts#L312-L325) - `pluginRoot`, the one place install, update and remove read `AHPD_PLUGIN_ROOT`"
  - "[code://packages/server/src/install.ts#L498-L549](../../../../packages/server/src/install.ts#L498-L549) - `updatePlugins`, the root it moves in and the sdk it answers when that moved"
  - "[code://packages/server/src/install.ts#L565-L589](../../../../packages/server/src/install.ts#L565-L589) - `removePlugins`, the root it uninstalls from"
  - "[code://packages/server/src/install.ts#L404-L416](../../../../packages/server/src/install.ts#L404-L416) - `refuseNonPlugins`, every name asked at once"
  - "[code://packages/server/src/plugins.ts#L169-L173](../../../../packages/server/src/plugins.ts#L169-L173) - where the daemon looks for plugins"
---

## Objective

`plugin update` and `plugin remove` work in the same directory as `plugin install`: `AHPD_PLUGIN_ROOT` when it is set, else the configuration directory.
An update that moves only `@ahpd/sdk` lists it as moved, so the daemon asks for a restart.
An update with nothing from the registry says "Nothing to update."
`plugin install` asks the registry about all its names at once.

## Files

- `UPDATE: packages/server/src/install.ts` - one `pluginRoot(configDir)` gives the root; install, update and remove use it for `dependenciesIn`, `installedVersion` and `--prefix`. Messages that name the directory name the root.
- `UPDATE: packages/server/src/install.ts:511-523` - `updatePlugins` reads the `@ahpd/sdk` version before and after npm, and adds it to `moved` when it changed.
- `UPDATE: packages/server/src/install.ts:506` - the early return says "Nothing to update." first.
- `UPDATE: packages/server/src/install.ts:387-399` - `refuseNonPlugins` asks for every name with `Promise.all`.
- `UPDATE: packages/server/test/` - the plugin install tests, with the cases below.

## Steps

1. Write the tests, with `AHPD_PLUGIN_ROOT` set to a temporary directory.
2. Add `pluginRoot` and use it in install, update and remove.
3. Report the sdk move, and say "Nothing to update." on the early return.
4. Ask the registry in parallel.

## Validation

- A test: with `AHPD_PLUGIN_ROOT` set, update runs npm with `--prefix` at the root and finds the plugins installed there.
- A test: with `AHPD_PLUGIN_ROOT` set, remove runs npm with `--prefix` at the root.
- A test: an update that changes only the `@ahpd/sdk` version answers it in `moved`, and the CLI says to restart.
- A test: an update whose names all come from outside the registry says "Nothing to update."
- A test: install with three names makes three registry calls before the first answers.
- `npx vitest run packages/server` passes.

## Resume

Implemented 2026-10-08 in the `build/agents/204c3797` worktree, test-first.
- In code: `pluginRoot(configDir)` reads `AHPD_PLUGIN_ROOT` once, and an empty value is the configuration directory, as `rootsOf` reads it.
  Install, update and remove take `--prefix`, `dependenciesIn` and `installedVersion` from it, and every message that names the directory names the root.
- In code: `updatePlugins` reads the sdk's installed version before npm and after it.
  It answers `{ name: '@ahpd/sdk', from, to }` in `moved` when that version changed, so an sdk that moved alone asks for a restart.
  The early return for a package that is not from the registry says `Nothing to update.`, and `refuseNonPlugins` asks every name with `Promise.all`.
- Tests: `packages/server/test/plugin-install.test.ts` gained five cases, and its fake runner now writes `lands` under the call's own `--prefix`, which is where npm would put them.
  `packages/server/test/server-cli.test.ts` gained the terminal case: an update that moved only the sdk answers `restart: true` and prints the restart line.
- Failing first: the six new cases and the CLI case failed against the code before the change.
  The CLI case answered `plugins: []` with no restart.
- `node tools/schema.mjs` 0, `pnpm build` 0, `pnpm typecheck` 0, `pnpm boundary` 0, full `npx vitest run --maxWorkers=2 --testTimeout=10000` 0, 251 files and 4375 tests passed.
- Found: an empty `AHPD_PLUGIN_ROOT` was unset to the loader and an unusable `--prefix` to install; `pluginRoot` follows the loader.
- Left: nothing here. Task 01 adds `--force` to the update, and task 04 documents it.
