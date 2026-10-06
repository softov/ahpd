---
title: A command says what it does to what, and the daemon serves on the cofold that checks it - implemented
date: 2026-10-06
refs:
  - "[code://packages/server/package.json#L47-L50](../../../../packages/server/package.json#L47-L50) - the `@cofold/*` ranges, moved to the release that carries `effect` and `resource`"
  - "[code://packages/server/src/commands/served.ts](../../../../packages/server/src/commands/served.ts) - `servedRegistry`, the commands `/api` serves"
  - "[code://packages/server/src/commands/usage.ts](../../../../packages/server/src/commands/usage.ts) - `usage.list` and `usage.show`"
  - "[code://packages/server/src/commands/plugin.ts](../../../../packages/server/src/commands/plugin.ts) - `plugin.config`, `plugin.config.set`, `plugin.config.unset`, and the effect and resource on every `plugin` verb"
  - "[code://packages/server/src/plugins.ts](../../../../packages/server/src/plugins.ts) - `PluginRow`, whose `name` is the key and whose `module` is what the package declares"
  - "[code://packages/server/test/server-commands.test.ts](../../../../packages/server/test/server-commands.test.ts) - the pinned manifest and the list-rows cases"
---

The daemon runs on the cofold release that gives an action an effect and a resource, and every command it serves declares both, so `/api/cli-manifest` tells a client which commands list, which create and which act on one row.
That release refuses the shapes ahpd served before, so `usage` is now two commands and `plugin config` three, with the words a person types unchanged.
Every list's rows carry the key its keyed commands take, so a client acts on a row by passing a field back and names nothing itself, and a removal asks at the terminal before it runs.

## What was built

- [`code://packages/server/src/commands/usage.ts`](../../../../packages/server/src/commands/usage.ts) - `usage.list` at `GET /usage` and `usage.show` at `GET /usage/{pool}`, one declaration each, because a route's `{param}` is required; `ahpd usage` and `ahpd usage <pool>` are unchanged.
- [`code://packages/server/src/commands/plugin.ts`](../../../../packages/server/src/commands/plugin.ts) - `plugin.config` (`ahpd plugin config <name>`) shows a plugin's options, `plugin.config.set` writes one and the new `plugin.config.unset` (`ahpd plugin config unset <name> <key>`, `POST /plugin/config/unset`) takes one out of the entry; all three keep the one lock, the `config:write` scope and the `deploymentTokenOnly` sentence.
- `commands/status.ts`, `config.ts`, `user.ts`, `teams.ts`, `plugin.ts`, `proxy.ts`, `usage.ts`, `vault.ts` - `effect` and `resource` on every command `servedRegistry` declares, by task 04's table; the commands only the line has (`start`, `stop`, `run`, `configure` and the rest) declare nothing.
- [`code://packages/server/src/plugins.ts`](../../../../packages/server/src/plugins.ts) - `PluginRow.name` is the key the entry is held under (`nameOf(spec)`), which is what `plugin enable` and the rest take, and the name the module or the manifest declares moved to `module`; `pluginLine` prints `module`, so `ahpd plugin list` reads as it read before.
- `commands/plugin.ts` - a served `plugin list` row masks the userinfo in `name` as it does in `spec`, since a spec that is a URL carries it in both.
- `docs/DAEMON.md` - the command list with the three `plugin config` forms, a paragraph saying the five removes ask first and that a script without a terminal passes `--yes`, the served `plugin config` routes, and what a served list row carries.

## Verified

- `npx tsc -b` clean.
- `pnpm boundary` clean: 8 packages, every dependency declared.
- `npx vitest run packages/server`: 38 files, 746 tests, all passing.
- `npx vitest run packages/agent-acp packages/agent-cofold`: 28 files, 361 tests, all passing.
- `npx vitest run packages/computer`: `computer-plugin.test.ts` green; three real-container cases (`computer-devcontainer`, `computer-parts-mount`, `computer-state-seed`) timed out at their 5 s default under the parallel load of the whole suite, and all three files pass alone (54 tests). No file those cases touch is changed by this plan.
- `npx vitest run packages/sdk packages/agent-claude packages/agent-pi packages/tunnel-devtunnel`: 206 of 207 tests passing; the one failure is `packages/sdk/test/wire.test.ts > the strict schema > is stale the moment the package it was built from is not the one installed`, which `execFileSync`s `node tools/schema.mjs` to build a schema before it asserts, takes about 2.8 s on an idle machine and crosses the 5 s default only under the load of the sweep. It passes alone with the timeout raised (6 tests, 4.9 s), no wire type this plan changed is involved, and `packages/sdk` is not modified by this plan, so it is pre-existing and load-induced rather than a regression.
- No whole-workspace `pnpm test` run is claimed: the sweep above is the same per-package `vitest run` that `pnpm test` performs after `node tools/schema.mjs`, and the two cases named are why it was not reported green as a whole.
- The manifest case pins all thirty served commands as `{ id, effect, resource }` and was written first, reading `null` everywhere until the fields went in.
- `ahpd user rm bob` with no terminal exits 2 saying `ahpd: user rm removes user bob; pass --yes to run it without a terminal` and leaves bob in the file; with `--yes` it runs.

## Departures from the plan

- Task 01's bump landed together with tasks 02 and 03: the release refuses `usage.list` and `plugin config` as they were, so moving the ranges alone would have been a daemon that does not start.
- `plugin.config.set` now requires all three of its fields. Without `required`, a request that named no `value` would have reached `typedValue(undefined)` and read as an unset.
- `plugin config unset <name> <key>` and `plugin config <name> <key> <value>` have as many words; the literal `unset` outscores a slot, so the unset wins and a plugin literally named `unset` can no longer have an option set from the line. Pinned in `plugin-config.test.ts`.
- The `--yes` fallout was four existing CLI cases (`user rm ada` twice, `plugin remove some-plugin` twice), which spawn with pipes and so have no terminal to ask.

## Left for later

- Nothing: every task is implemented and no work is deferred. `deferred.md` is not written.
- The plan's status stays `planned` until the review closes it; the task files say `implemented`.
