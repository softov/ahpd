---
title: A list's rows carry the key its item commands take
status: todo
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
