---
title: A plugin installs a package into its folder
status: done
depends: []
layer: "sdk, server, docs"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L761-L773](../../../../packages/sdk/src/types/plugin.ts#L761-L773) - `PluginHost`, beside `problem`"
  - "[code://packages/server/src/plugins.ts#L1165](../../../../packages/server/src/plugins.ts#L1165) - `base`, the plugin's own folder"
  - "[code://packages/server/src/pluginschannel.ts#L540-L548](../../../../packages/server/src/pluginschannel.ts#L540-L548) - the npm run of plan 64"
---

## Objective

A plugin calls `host.install(spec)`, and the package is installed into `installed/` inside the plugin's folder, where the plugin can import it from `host.installed`.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts` - `install(spec)` and `installed` on `PluginHost`, and the answer type.
- `UPDATE: packages/sdk/src/plugins/plugins.ts` - the host option that runs an install.
- `UPDATE: packages/server/src/plugins.ts` - `loadOne` gives the plugin `installed` under `base`, and runs npm there.
- `UPDATE: packages/sdk/src/types/index.ts` - `InstallAnswer` on the public type surface.
- `CREATE: packages/server/test/plugin-host-install.test.ts` - the install call with a fake npm.
- `UPDATE: docs/plugins/PLUGINS.md` - `install` and `installed` in the `PluginHost` table.

## Steps

1. Add `installed`, the absolute path of `installed/` in the plugin's folder, to `PluginHost`.
2. Add `install(spec)` to `PluginHost`, answering `{ version }` or `{ error }`.
3. Create `installed/package.json` on the first install when it does not exist.
4. Run `npm install --prefix <installed> --ignore-scripts --no-audit --no-fund <spec>` through the same runner that plan 64 uses.
5. Read the version npm installed from `installed/node_modules/<name>/package.json`.
6. Answer `{ error }` with the last npm error line when npm fails.
7. Run one install at a time for a plugin, and queue the next one.
8. Answer `{ error }` for a plugin that has no folder of its own.
9. Document `install` and `installed` in `PLUGINS.md`.

## Validation

- `plugin-install.test.ts`: with a fake npm, an install answers the version and writes into `installed/` only.
- The same file: a failed npm answers its error, and two calls at once run one after the other.
- The fake npm sees `--ignore-scripts`.
- The gate passes: `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`.

## Resume

- **Done so far:** `PluginHost` carries `installed?: string` and `install(spec): Promise<InstallAnswer>`, and `InstallAnswer` is `{ version } | { error }` on the public type surface. `pluginHost` answers an empty spec or a plugin with no folder with an error. A folder plugin is handed the path of `installed/` under its own folder. `loadOne` gives every plugin a host whose `install` runs npm as `npm install --prefix <installed> --ignore-scripts --no-audit --no-fund <spec>` through plan 64's runner. The first install writes `installed/package.json` with the name `ahpd-installed`. The version is read from `installed/node_modules/<name>/package.json`. A failed npm answers its last standard-error line, and a URL's userinfo in that line is masked. One install runs at a time per plugin, and a second waits for the first. `loadOne` and `pluginSet` take the runner as `run`, so a test fakes npm.
  The plan's three checks pass in `plugin-host-install.test.ts` with 6 tests. The full gate ran: 428 files and 7067 tests, with 29 skipped and one failure, a 5 second timeout in `computer-plugin.test.ts` that passes alone.
- **Next action:** none, this task is implemented.
- **Files:** `packages/sdk/src/types/plugin.ts`, `packages/sdk/src/types/index.ts`, `packages/sdk/src/plugins/plugins.ts`, `packages/server/src/plugins.ts`, `packages/server/test/plugin-host-install.test.ts`, `docs/plugins/PLUGINS.md`.
- **Open questions:** none.
- **Departures:** the plan names `packages/server/test/plugin-install.test.ts`, and that file already exists for the `ahpd plugin install` command. The new test is `plugin-host-install.test.ts`. `installed` is optional on the host, because a plugin with no folder of its own has no path. `install` is always there, and answers the sdk's own error for one with no folder, which is step 8. The answer type is also exported from `types/index.ts`, which the Files list does not name. The runner is an option on `LoadOptions` and `LoadOneOptions`, so no test reaches the registry; `plugins.ts` imports `run` and `Runner` from `install.ts`. `install` refuses a spec that starts with `-`, or holds whitespace, a quote or `%`, and runs no npm for it.
- **Watch out for:** `installed/` is what npm changes, and the plugin's own `node_modules` is not npm's to change. One plugin's installs are one chain, keyed by name: a failed install does not stop the next one.

