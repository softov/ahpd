---
title: Activepieces installs a missing piece
status: done
depends: [task-01-a-plugin-installs-a-package.md]
layer: "activepieces, docs"
refs:
  - "[code://packages/activepieces/package.json#L90-L100](../../../../packages/activepieces/package.json#L90-L100) - the `pieces` pattern"
  - "[code://packages/activepieces/src/plugin.ts#L182-L193](../../../../packages/activepieces/src/plugin.ts#L182-L193) - `apply`"
  - "[code://packages/activepieces/src/child.ts#L144-L151](../../../../packages/activepieces/src/child.ts#L144-L151) - the import of a piece"
---

## Objective

A piece name saved in the options installs when it does not resolve, and its connector shows. Each install and each piece that does not load is an alert on the plugin's row.

## Files

- `UPDATE: packages/activepieces/package.json:90-100` - the `pieces` pattern accepts `@<version>` after the name.
- `UPDATE: packages/activepieces/src/plugin.ts:182-193` - `apply` installs each missing piece before it asks the child to describe them.
- `UPDATE: packages/activepieces/src/child.ts:144-151` - the child imports a piece by its package name, from its own `node_modules` or from `installed/`.
- `UPDATE: packages/activepieces/src/wire.ts` - the describe request carries the `installed` folder.
- `UPDATE: packages/activepieces/test` - the version in a name, the install and the alerts.
- `UPDATE: packages/activepieces/README.md` - how a person adds a piece, with or without a version.

## Steps

1. Change the `pieces` pattern to accept an optional `@<version>` after the package name.
2. Split each name into its package name and its version.
3. Resolve each package name from the plugin's own `node_modules` and from `host.installed`.
4. Call `host.install` for each name that does not resolve, or whose written version is not the one installed.
5. Raise an `info` alert with `ref` `piece:<package>` and the version when an install ends.
6. Raise an `error` alert with the same `ref` and the npm error when an install fails.
7. Send `host.installed` to the child in the describe request.
8. Make the child import a piece by its package name.
9. Make the child try `installed/` when its own `node_modules` does not have the piece.
10. Raise a `warning` alert with `ref` `piece:<package>` for each piece that still does not load, in place of `host.problem`.
11. Document in the README how to add a piece, with and without a version.

## Validation

- A test: a name with `@0.5.1` passes the pattern, and the child imports it by the name without the version.
- A test with a fake `host.install`: the plugin installs a missing piece once, and gives it the alert above.
- The same test: the plugin installs no piece that is in `package.json`.
- A test: an install that fails leaves the other pieces as adapters.
- The gate passes: `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`.
- By hand, in a test daemon with XDG temp dirs: `@activepieces/piece-postgres@0.5.1` in the options shows a Postgres connector.

## Resume

- **Done so far:** the `pieces` pattern takes an optional version after the name, as in `@activepieces/piece-postgres@0.5.1`. `apply` splits each written name into its package and its version. It looks the package up in the plugin's own `node_modules` first, and then in `host.installed`. A name that is missing, or not at the version written, is installed through `host.install`. The installs run one at a time, in the order the options name them. A finished install is an `info` alert with `ref` `piece:<package>` and the version npm left. A failed one is an `error` alert with the same `ref` and npm's error. The child is asked for the packages alone, never a name with a version, and the describe request carries `installed`. The child imports a package by its name. A name that does not resolve is looked up in `installed/`, and imported from the file it resolves to. A piece that still does not load is a `warning` alert with the same `ref`, in place of the `problem` line it used to be. The README says how a person adds a piece, with and without a version.
  `install.test.ts` has the plan's four checks in 6 tests. The full gate ran: 428 files and 7067 tests, with 29 skipped and one failure, a 5 second timeout in `computer-plugin.test.ts` that passes alone.
- **Next action:** none, this task is implemented. The by-hand check in the plan's Validation was not run, because it needs the network.
- **Files:** `packages/activepieces/package.json`, `packages/activepieces/src/plugin.ts`, `packages/activepieces/src/child.ts`, `packages/activepieces/src/wire.ts`, `packages/activepieces/test/install.test.ts`, `packages/activepieces/README.md`.
- **Open questions:** none.
- **Departures:** `installed` is on the run request as well as the describe request. A child that started again after an install still has to find a piece that lives in `installed/`, and a run carries no describe. The child's error lines stay one string each. The parent maps one to its package by the `<package>: ` prefix the child writes, because the Files list changes only `installed` in `wire.ts`. The options description in `package.json` says the version form too, beside the pattern. The dependency lookup falls back to the plugin's own resolution when the host answers no `installed`. That is what a host from before plan 68 looks like, and the pieces tests use one.
- **Watch out for:** a piece with a version written runs from `installed/` when that folder holds the version, also when the plugin ships the piece. The describe request names those pieces in `installedFirst`, and a run of one carries `installedFirst: true`. A piece whose install failed keeps its `error` alert, and the load warning for it is not raised.

