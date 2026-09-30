---
title: Updating named plugins is refused before npm while another installed plugin is behind the daemon's minor
status: dropped
depends: [task-06-the-plugin-keeps-npms-sdk.md]
layer: "server"
refs:
  - "[code://packages/server/src/install.ts](../../../../packages/server/src/install.ts) - `updatePlugins`, and `behind` with install's refusal wording"
---

## Objective

`ahpd plugin update <name>...` checks, before it calls npm, for installed `@ahpd/*` packages it was not given whose minor differs from the daemon's.
When there are any, it calls no npm and fails with install's sentence: each blocker as `<name> <version>`, then `Run ahpd plugin update all to move every plugin to <version>.`
`update all` and an update whose other `@ahpd` plugins are all on the daemon's minor are unchanged.

## Steps

1. Failing first: a configuration directory with `@ahpd/agent-claude` and `@ahpd/agent-acp` at 0.7.0 and a 0.8.0 daemon; `update @ahpd/agent-acp` makes no npm call and names `@ahpd/agent-claude 0.7.0` and `ahpd plugin update all`, at the terminal and over HTTP.
2. The same directory with both at 0.8.0: `update @ahpd/agent-acp` calls npm as before.

## Validation

- `pnpm typecheck`, `pnpm boundary`, full `pnpm test` 3 times.

## Resume

Implemented 2026-09-29, in the `fixes-0-8-1` worktree.
`updatePlugins` with names, once the registry packages to move are known, calls `behind` with them before npm; any blocker throws an `NpmFailure` with no npm reason: `npm could not update <names>: <blockers> is/are installed for another @ahpd/sdk. Run ahpd plugin update all to move every plugin to <version>.` The sentence after the colon is `heldBack` in `install.ts`, which `installPlugins` uses too. `update all` is unchanged.
Failing first: `refuses to update named plugins before npm while another installed plugin is behind the daemon` (`test/plugin-install.test.ts`) resolved instead of refusing; the CLI case in `test/server-cli.test.ts` exited 0; the HTTP case in `test/server-http.test.ts` answered 200. All three now name `@ahpd/agent-claude <version>` and `ahpd plugin update all` with no npm call (the fake npm's log is never written). `updates a named plugin when every other installed plugin is on the daemon's minor` guards the unchanged path and passed before and after. `updates only the packages it is named` had a 0.7.0 `@ahpd/agent-acp` beside it, which this task now refuses; its fixture has that package at 0.8.0.

Dropped 2026-09-29: [the daemon installs its own sdk beside the plugins](../../../decisions/the-daemon-installs-its-own-sdk-beside-the-plugins.md), so nothing blocks a named update; task 08 removes its code.
