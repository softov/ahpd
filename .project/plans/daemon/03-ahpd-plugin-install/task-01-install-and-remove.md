---
title: plugin install and plugin remove
status: done
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/main.ts#L601-L620](../../../../packages/server/src/main.ts#L601-L620) - the `plugin` verb"
  - "[code://packages/server/src/plugins.ts#L59-L62](../../../../packages/server/src/plugins.ts#L59-L62) - `nameOf` and `hasScheme`, to match entries and refuse non-package specs"
  - "[code://packages/server/src/config.ts#L108-L167](../../../../packages/server/src/config.ts#L108-L167) - where the directory and file are"
---

## Objective

`ahpd plugin install <name>...` installs into the configuration directory and adds the names to `plugins`; `ahpd plugin remove <name>...` does the reverse.

## Files

- `CREATE: packages/server/src/install.ts` - the npm argument list, the pinning, and the `plugins` edit, as functions that take a runner so tests need no network.
- `UPDATE: packages/server/src/main.ts` - the `plugin` verb takes `install` and `remove`; `USAGE` lists them.
- `CREATE: test/plugin-install.test.ts`.

## Steps

1. Refuse a spec that is a path or has a scheme (`hasScheme`, or starts with `.` or `/`), with a sentence saying a path is used as written.
2. Pin: `@ahpd/<x>` with no `@version` becomes `@ahpd/<x>@<version()>`, unless `version()` is `unknown`.
3. `ensureConfigDir()`, then run `npm install --prefix <configDir> <pinned...>` with inherited stdio. No `--allow-scripts`: checked 2026-09-26 with npm 12.0.2, npm refuses it on a project-scoped install (`EALLOWSCRIPTS`) and points at the project's `package.json` or `.npmrc`. The SDK's optional `node-pty` is the daemon's own and is built by its global install.
4. Unless `--no-enable`, read the configuration file (`--config-file` or `configPath()`), add each name whose `nameOf` is not already in `plugins`, and write it back as two-space JSON with a trailing newline. Create the file if it is absent.
5. Print the directory installed into, the names added to `plugins`, and "restart the daemon to load them" when `daemon.json` says one is running.
6. `remove`: drop matching entries from `plugins` (string or object form), then `npm uninstall --prefix <configDir> <names>` unless `--keep`.

## Validation

- `test/plugin-install.test.ts` with a fake runner and a temporary `XDG_CONFIG_HOME`:
  - `@ahpd/agent-claude` is pinned to the daemon's version; `left-pad@1` is passed as written.
  - a path and an `npm:` spec are refused before npm runs.
  - `plugins` gains the name once, keeps an existing object entry with options, and keeps every other key.
  - `--no-enable` leaves the file untouched.
  - `remove` drops a string entry and an object entry, and `--keep` skips the uninstall.
- By hand, with the real npm, in a clean `XDG_CONFIG_HOME`: install `@ahpd/agent-claude`, `ahpd plugin list` shows it, `ahpd` starts with it. `node-pty` is the daemon's own copy and is what its global install builds, not this one.

## Resume

Implemented 2026-09-26 in `packages/server/src/install.ts`, `packages/server/src/main.ts` and `test/plugin-install.test.ts` (9 cases, all green). `pnpm typecheck` and `pnpm boundary` are green and the full suite is 1122 tests.
The one deviation from the plan is the `--allow-scripts` flag, which npm 12 refuses on a project-scoped install; the plan's *Decisions locked in* table and *Risks* were amended.
The real-npm install could not be run here because the npm cache is read-only, so the by-hand line under *Validation* is what the verifier still has to do.

