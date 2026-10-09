---
title: "`ahpd plugin update` moves every installed plugin together"
status: done
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/commands/plugin.ts#L70-L126](../../../../packages/server/src/commands/plugin.ts#L70-L126) - the sibling commands"
  - "[code://packages/server/src/install.ts#L92-L97](../../../../packages/server/src/install.ts#L92-L97) - `pinned`"
---

## Objective

`ahpd plugin update all` moves every registry dependency in the configuration directory's `package.json`; `ahpd plugin update <name>...` moves only those, each of which must be installed there. An `@ahpd/*` package goes to the daemon's version, any other registry package to `latest`, and one from a path, link, git or URL is left as installed and said so. `ahpd plugin update` with neither refuses, showing both forms. HTTP takes the same choice in its body. It says each package it moved and from which version, and says to restart when a daemon is running.
`update` makes one npm call for everything it moves, and when that call fails the whole update fails with the `NpmFailure` line, which tells the person to rerun with `--force` to update only the plugins that can be updated.
`update --force` installs each package in its own npm call, so the others move and the failing one is named.

## Files

- `UPDATE: packages/server/src/install.ts` - `updatePlugins`, beside `installPlugins`, through the same `Runner`.
- `UPDATE: packages/server/src/commands/plugin.ts` - the `plugin.update` action, in `oneAtATime`.
- `UPDATE:` the server's command tests where `plugin install` is tested.

## Steps

1. Tests first with a faked runner: four 0.7.0 `@ahpd` packages and one third-party package give one npm call with the four at the daemon's version and the other at `latest`; an empty `package.json` makes no call; a failed npm call fails the command with its reason once.
2. Implement, mirroring `plugin install`'s surfaces, scope, `deploymentTokenOnly` and restart line.
3. Tests first with a faked runner whose npm call fails for one package: `update all` makes one call, moves nothing, and its failure line names `--force`; `update all --force` makes one call per package, moves the others, and names the failing one.
4. Add `--force` to the CLI and `force` to the HTTP body, through the same `updatePlugins`.

## Validation

- The new cases fail first and pass after.
- The one-call failure and the `--force` path each have a case in `test/plugin-install.test.ts`.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

Implemented 2026-09-29, in the `fixes-0-8-1` worktree.
`updatePlugins` in `packages/server/src/install.ts` reads the `dependencies` of the configuration directory's `package.json`, runs one `npm install --prefix <dir>` with each `@ahpd/*` name through `pinned` and any other at `@latest`, and says `<name>: <installed version> to <target>` for each; no dependencies says `No plugin is installed in <dir>.` and runs nothing. The `plugin.update` action in `packages/server/src/commands/plugin.ts` (`ahpd plugin update`, `POST /plugin/update`) runs it inside `oneAtATime`, with `config:write`, `deploymentTokenOnly` and the restart line of `install`, and answers `{ plugins, restart? }`.
Failing first: the three `updatePlugins` cases in `test/plugin-install.test.ts` (not exported), `plugin.update` missing from the scopes case in `test/server-commands.test.ts`, and `POST /api/plugin/update` answering 404 in `test/server-http.test.ts`. The bare `ahpd plugin` message in `test/server-cli.test.ts` now lists `update`.
Reopened for the registry-only row, and implemented again 2026-09-29: `dependenciesIn` answers each name with its spec, and `fromRegistry` leaves out a path, `file:`, `link:`, `git+`, `git:`, `github:` or http(s) spec. Each one left out is said as `<name>: <spec>, left as installed`, and when nothing is left to move no npm call runs. `docs/DAEMON.md` says so.
Failing first: `leaves a package installed from outside the registry as it is, and says so` saw all eight names in the npm call, and `runs no npm when every package came from outside the registry` saw a call for `mine`. Both pass after.
Reopened for `all` or names, and implemented again 2026-09-29: `updatePlugins(names, options)` takes `'all'` or the names, refuses a name not in `package.json` before npm runs (`<name> is not installed in <dir>.`), and moves only what it was given; a name with a version is passed as written. The `plugin.update` action takes `:name...` (`name` in the HTTP body), reads a lone `all` as every package, and refuses `all` beside other names with `Say which plugins to update: ahpd plugin update all, or ahpd plugin update <name>...`.
Failing first: `updates only the packages it is named` and `refuses to update a name that is not installed, before npm runs` in `test/plugin-install.test.ts` failed on the old signature, and the HTTP case saw 200 for an empty body. All pass after.
Open: plain `ahpd plugin update` cannot show both forms yet. `@cofold/commands` 0.2.2 rejects the optional variadic slot `:name?...` in `commandFor` (`the pattern names :name?, which is not an input field`), so the slot is the required `:name...`, and a bare `update` gets cofold's own refusal (CLI `unknown command "plugin update"`, exit 2; HTTP `name is required`, 400). This is the same cofold gap as task 03.
Reopened 2026-10-04 for `--force`: the one-call failure names `--force`, and `--force` installs each package in its own call.
Implemented 2026-10-08 for `--force`. `updatePlugins` takes `force?: boolean`. Absent, the packages move in one npm call as before, and a failed call throws `npm could not update <names>; rerun with --force to update only the plugins that can be updated` beside npm's reason. Set, each package is its own `npm install` with the daemon's sdk; every one is attempted, what moved is said, and the ones npm refused end the command with `npm could not update <names>` and the first refusal's reason. The `plugin.update` action declares `force` beside `name`, so both `ahpd plugin update all --force` and a `force: true` in the HTTP body reach the same `updatePlugins`, and its description says the call count either way.
Failing first: `moves the others, and names the one npm cannot install, with --force` and `moves every package in its own npm call with --force, and fails none of them` in `test/plugin-install.test.ts` (the second saw one call naming both packages); `update --force installs each package in its own npm call` in `test/server-cli.test.ts` (exit 2 while `--force` was undeclared); and the body assertion added to the `plugin update` case in `test/server-http.test.ts` (one call naming both packages). `fails an update with npm's reason, once, and names --force` replaces the old one-call expectation with the new line.
The `--force` path loses the restart line, because the action's `stop()` ends the command before it is said: the person is told what npm refused and the moves are already on screen.
