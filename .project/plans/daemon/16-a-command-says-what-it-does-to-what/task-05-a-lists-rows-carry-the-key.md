---
title: A list's rows carry the key its item commands take
status: done
depends: [task-04-every-served-command-declares-its-effect.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/plugin.ts#L30-L63](../../../../packages/server/src/commands/plugin.ts#L30-L63) - `plugin.list` rows: `spec` always, `name` only when the package has one"
  - "[code://packages/server/test/server-commands.test.ts](../../../../packages/server/test/server-commands.test.ts) - the manifest cases"
---

## Objective

For every resource kind with a keyed command, each row its list answers has a field named as the key, holding the value that command accepts.
A client can then act on a listed row by passing that field, with nothing named in the client.

## Files

- `UPDATE: packages/server/src/commands/plugin.ts:30-63` - if a row's `name` is not the name `plugin enable` takes (the configured spec's key), the row gains it under `name` and the package name moves to another field.
- `UPDATE:` any other list whose rows lack the key, found by the test.
- `UPDATE: packages/server/test/server-commands.test.ts` - the case below.

## Steps

1. Test first: for each kind in task 04's table with a keyed command, run its list against a fixture daemon and check each row has the key field.
2. For `plugin`, check that `plugin enable <row.name>` finds the plugin for a path, a git and an npm spec.
3. Fix the rows the test finds.

## Validation

- The test passes for `user`, `team`, `project`, `plugin`, `pool` and `secret`.
- `ahpd plugin list` prints what it prints today.
- `pnpm test` green.

## Resume

Implemented 2026-10-06. `packages/server/test/server-commands.test.ts` builds a daemon over a file holding one of everything and runs each of the six keys task 04's table names - `user.list` and `team.list` and `project.list` by `id`, `plugin.list` by `name`, `usage.list` by `pool`, `vault.list` by `name` - checking every row carries that field and that it is not empty. Only `plugin` failed it.
`PluginRow.name` was the name the module or the manifest declares, which for a path, a git URL or an object spec is not the name `plugin enable` takes, so it is now `nameOf(spec)` - the key the entry is held under, and the one every other `plugin` verb reads - and the declared name moved to `module`. The second case runs `plugin enable <row.name>` for a path, a git URL and a package name, which is the command's own lookup and refuses a name no entry carries. `pluginLine` prints `module`, so `ahpd plugin list` reads as it read before, and the served mask replaces the userinfo in `name` as it does in `spec`, since a spec that is a URL carries it in both.
The tests that pinned the old meaning follow: six cases in `plugin-list.test.ts`, one each in `uri-resources-plugin.test.ts`, `computer-plugin.test.ts`, `agent-acp-plugin.test.ts` and `agent-cofold-plugin.test.ts`, each now reading `module` for what the package calls itself and, where a path is written, `name` for the path. `docs/DAEMON.md` says a served row carries `name` beside `module` and that every list answers its kind's key.
