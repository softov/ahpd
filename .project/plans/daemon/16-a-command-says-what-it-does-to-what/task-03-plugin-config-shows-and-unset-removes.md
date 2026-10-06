---
title: plugin config shows, and plugin config unset removes
status: done
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

Implemented 2026-10-06. `plugin.config` is `ahpd plugin config <name>` at `POST /plugin/config` and shows every option, with `name` required; `plugin.config.unset` is new, at `ahpd plugin config unset <name> <key>` and `POST /plugin/config/unset`, with `name` and `key` required and the removal branch of `configure` behind it; `plugin.config.set` is unchanged but now requires its three fields, so a request with no value is refused rather than read as an unset. `configure` takes which of the three it is and keeps the one lock, the `config:write` scope and the `deploymentTokenOnly` sentence on all three.
`packages/server/test/plugin-config.test.ts` drives one line through `@cofold/terminal`'s `Program` over the registry and globals `main.ts` builds, which pins the refusal `ahpd plugin config <name> <key>` gets - `ahpd: unknown command "plugin config <name> <key>". Try ahpd --help`, exit 2 - and that `plugin config unset <name> <key>` reaches the removal rather than a set of the option on a plugin named `unset`, since the literal outscores the slot. `docs/DAEMON.md`'s command list, its `plugin config` section and its API paragraph follow.
