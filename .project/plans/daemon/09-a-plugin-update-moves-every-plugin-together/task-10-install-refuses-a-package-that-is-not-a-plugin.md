---
title: Install refuses a registry package that is not an ahpd plugin, and update says the versions it installed
status: implemented
depends: [task-08-the-daemon-pins-the-sdk.md]
layer: "server"
refs:
  - "[code://packages/server/src/install.ts](../../../../packages/server/src/install.ts) - `installPlugins` and `updatePlugins`"
  - "[code://packages/server/src/update.ts#L60-L110](../../../../packages/server/src/update.ts#L60-L110) - the registry the daemon already asks, and how"
  - https://registry.npmjs.org/@ahpd%2Fagent-claude/0.8.0 - a version's manifest, with its `ahpd` field
---

## Objective

Before npm runs, `plugin install` fetches `<registry>/<name>/<version or tag>` for each registry name, at the version it would install, and refuses the whole call with `<name> is not an ahpd plugin: its package.json has no "ahpd" field.` when a manifest has no `ahpd` field.
A path, link or git spec is not checked, and a registry that cannot be reached leaves the call to npm.
`plugin update` prints each package's version before and the version npm installed after, read from `node_modules`, and leaves out a package whose version did not move.

## Steps

1. Failing first, with a fake fetch: `@softov/ahpc` (no `ahpd`) is refused and npm is not called; `@ahpd/agent-claude` passes; a path spec is not fetched; a fetch that fails lets npm run.
2. Update: `0.6.0 to 0.7.1` from what is on disk after npm, not `latest`; an unmoved package is not printed.

## Validation

- `pnpm typecheck`, `pnpm boundary`, full `pnpm test` 3 times.

## Resume

Implemented 2026-09-29 in the `fixes-0-8-1` worktree, test-first.
- In code: `update.ts` gains `askRegistry(path, { registry, timeoutMs, fetch })`, the one GET against `registry()` that `refreshUpdate` now uses too, and the `Fetch` type. `installPlugins` takes `fetch` beside `run` and, after the name checks and before npm, asks `<registry>/<name with %2f>/<version or tag>` for each name that reads as a registry package: an `@ahpd/` name at the daemon's version, any other at the version or tag written, else `latest`. A manifest with no `ahpd` field refuses the whole call with `<name> is not an ahpd plugin: its package.json has no "ahpd" field.`; no answer or a non-`ok` one leaves it to npm. A path, a scheme and git's `owner/repo` are not asked. `updatePlugins` reads each version from `node_modules` after npm and says `<name>: <before> to <after>` only when it changed. `commands/plugin.ts` passes the global `fetch`.
- Tests: a fake `Fetch` in `plugin-install.test.ts`; the CLI and HTTP suites set `npm_config_registry` to `http://127.0.0.1:1`, so their installs skip the check and reach the fake npm. Failing first: the no-`ahpd` refusal resolved, the pass case and the failing-fetch case asked nothing, and update said `to latest` and `0.6.0 to latest` instead of the versions on disk. The path case passed before too, since a path was already refused as not a package name.
- By hand against registry.npmjs.org: `plugin install @softov/ahpc` exits 2 with `@softov/ahpc is not an ahpd plugin: its package.json has no "ahpd" field.` and creates nothing; `plugin install @ahpd/agent-pi` passes the check, installs 0.8.0 and names it.
- `pnpm typecheck` 0, `pnpm boundary` 0, full `pnpm test`: run 1 exit 1 (1748 of 1749, ENOTEMPTY in agent-acp-ports' cleanup), runs 2 and 3 exit 0, 1749 passed.
Added 2026-09-29, approved by Softov:
- `updatePlugins` says `Nothing to update.` when it ran npm and no package's version moved, for `all` and for names. Failing first with the fake runner: an update whose versions are the same on disk before and after said nothing.
- `docs/DAEMON.md` says `plugin install` refuses a registry package whose `package.json` has no `"ahpd"` field before npm runs, and that `update` says `Nothing to update.` when no version moved. No em dash; the file's wrapping kept.
- `pnpm typecheck` 0, `pnpm boundary` 0, full `pnpm test`: run 1 exit 1 (1749 of 1750, ENOTEMPTY in computer-devcontainer's cleanup), runs 2 and 3 exit 0, 1750 passed.
