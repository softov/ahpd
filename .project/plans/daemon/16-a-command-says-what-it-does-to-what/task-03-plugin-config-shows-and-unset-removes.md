---
title: plugin config shows, and plugin config unset removes
status: todo
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/commands/plugin.ts#L180-L330](../../../../packages/server/src/commands/plugin.ts#L180-L330) - `configFields`, `configure`, `plugin.config` and `plugin.config.set`"
  - "[code://packages/server/test/plugin-config.test.ts](../../../../packages/server/test/plugin-config.test.ts) - the plugin config cases"
---

## Objective

`plugin.config` (`ahpd plugin config <name>`) only shows a plugin's options, and `plugin.config.unset` (`ahpd plugin config unset <name> <key>`, `POST /plugin/config/unset`) removes one, beside `plugin.config.set`.

## Files

- `UPDATE: packages/server/src/commands/plugin.ts` - `plugin.config` without `key`; a new `plugin.config.unset` with `name` and `key` required, taking the removal branch of `configure`.
- `UPDATE: packages/server/test/plugin-config.test.ts` - the cases below.

## Steps

1. Tests first.
2. Split `configure` at its `key` branch; the unset keeps the same lock (`oneAtATime`), scopes and messages as the removal does today.

## Validation

- `ahpd plugin config <name>` shows the options; `ahpd plugin config unset <name> <key>` removes one; `ahpd plugin config <name> <key> <value>` still sets.
- `ahpd plugin config <name> <key>` is refused; the test pins the message it gets.
- `ahpd plugin config unset a b` runs the unset, not a set of plugin `unset`; `matchCommand` scores a literal over a slot (file:///github/cofold/packages/commands/src/argv.ts).
- The served routes answer the same as the line.
- `pnpm test` green.

## Resume
