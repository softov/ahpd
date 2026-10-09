---
title: A plugin update moves all or the named plugins - implemented
date: 2026-10-08
refs:
  - "[code://packages/server/src/install.ts#L498-L585](../../../../packages/server/src/install.ts#L498-L585) - `updatePlugins` and its `force`"
  - "[code://packages/server/src/commands/plugin.ts#L142-L181](../../../../packages/server/src/commands/plugin.ts#L142-L181) - the `plugin.update` action"
  - "[code://packages/server/test/plugin-install.test.ts](../../../../packages/server/test/plugin-install.test.ts) - the `updatePlugins` cases"
  - "[code://docs/DAEMON.md#L69-L78](../../../../docs/DAEMON.md#L69-L78) - the upgrade paragraph"
  - "[code://.project/decisions/plugin-update-takes-all-or-names.md](../../../decisions/plugin-update-takes-all-or-names.md)"
---

The plan's last two open tasks are implemented, and every task in it is now implemented or dropped: `ahpd plugin update` takes `--force`, and `docs/DAEMON.md` says what a failed update does.
A `plugin update` whose npm call fails says so once at the terminal, names `--force`, and leaves everything where it was; with `--force` each package is its own npm call, so the ones npm can install move and the ones it refuses are named in the line that ends the command.
Nothing is committed: Softov reads the diff first.

## What was built

- [`code://packages/server/src/install.ts`](../../../../packages/server/src/install.ts) - `UpdateOptions` gained `force?: boolean`. Absent, the packages move in one `npm install` as before, and a failed call throws `npm could not update <names>; rerun with --force to update only the plugins that can be updated` with npm's reason beside it. Set, each moving package is its own `npm install` with the daemon's `@ahpd/sdk`; every package is attempted, what moved is said, and the refused ones end the command with `npm could not update <names>` and the first refusal's reason. `Nothing to update.` is left unsaid on that path, because the refusal that follows says why nothing did. The moves are read from disk after the calls either way, so the two paths share one answer.
- [`code://packages/server/src/commands/plugin.ts`](../../../../packages/server/src/commands/plugin.ts) - the `plugin.update` action declares `force` beside `name`, so `ahpd plugin update all --force` and a `force: true` in the HTTP body reach the same `updatePlugins`; its description says the call count either way. The action itself, its scopes, its `deploymentTokenOnly` and its restart line are unchanged.
- [`code://packages/server/test/plugin-install.test.ts`](../../../../packages/server/test/plugin-install.test.ts) - the fake runner can answer by the last argument as well as by the verb, so one package of a `--force` update can fail where the others land; `fails an update with npm's reason, once, and names --force` carries the new one-call line, and `moves the others, and names the one npm cannot install, with --force` and `moves every package in its own npm call with --force, and fails none of them` are the new cases.
- [`code://packages/server/test/server-cli.test.ts`](../../../../packages/server/test/server-cli.test.ts) - `update --force installs each package in its own npm call` reads the fake npm's log and finds one call per package, which is what an undeclared flag would have made exit 2 instead.
- [`code://packages/server/test/server-http.test.ts`](../../../../packages/server/test/server-http.test.ts) - the `plugin update` case gained a second registry dependency and a `force: true` body, whose last two npm calls name one package each.
- [`code://docs/DAEMON.md`](../../../../docs/DAEMON.md) - the upgrade paragraph says one package npm cannot install fails that whole call, that the failure says to rerun with `--force`, and that `--force` gives each package its own `npm install` so the ones npm can install move and the one it cannot is named; the command list says the same in one clause on the `update all` row. The file's own wrapping is kept and there is no em dash.

## Verified

- **Failing first**, each by re-running the new case against the source without the change: the two `--force` cases in `plugin-install.test.ts` failed on the one call both packages were named in; the CLI case exited 2 because `--force` was undeclared; the HTTP case saw one call naming both packages because the body's `force` reached nothing. The one-call case's new expectation replaces the old `npm could not update @ahpd/agent-claude: ...` line, which no longer exists.
- `pnpm build` clean, over all nine packages.
- `pnpm typecheck` clean.
- `pnpm boundary` clean: nine packages, every dependency declared.
- `npx vitest run --maxWorkers=2 --testTimeout=10000`: 254 files, 4416 tests, all passing. `node tools/schema.mjs` has to run first, as `pnpm test` does, or six `packages/sdk` files fail on a missing `tools/ahp.strict.schema.json`; that is the harness's step and not this plan's.
- The plan's final checklist is covered as far as a box with no npm registry can cover it: the four 0.7.0 `@ahpd` packages and the one third-party package are `plugin-install.test.ts`'s one-call case with a faked runner, the failed-install wording is task 02's cases, and the `--force` line is the two new cases. The by-hand runs the checklist names were not made, because this box has no network egress and every one of them needs a real `npm install`.

## Departures from the plan

- `update --force` still fails the command when a package was refused, rather than answering 200 with the refusal somewhere in the body. The plan says the failing one is named and does not say where. It is derived rather than picked: task 11 locked the answer to `{ name, from, to }` rows of what moved, so a refused package has no row to appear in, and task 02 says a served npm failure keeps npm's reason, which only a thrown `NpmFailure` carries.
- On that path the restart line is not said, because the action's `stop()` ends the command at the failure and the restart line is written after `updatePlugins` returns. The moves themselves were already said, so the terminal has them.
- The `--force` hint is on every one-call failure, not only on `update all`: task 01's objective says "`update` makes one npm call ... and its failure line", where the decision row says `update all`.
- `packages/server/README.md` was in task 04's Files and is unchanged. Its upgrade line carries no flag for `install` either, and it lists both update forms without flags already.

## Left for later

- The two by-hand checklist runs: a real 0.7.0 to 0.8.0 upgrade in a configuration directory, and a real `--force` with one package the registry does not have.
- `updatePlugins` names the first refusal's reason when `--force` leaves several packages behind; the served message carries that one reason for all of them.
