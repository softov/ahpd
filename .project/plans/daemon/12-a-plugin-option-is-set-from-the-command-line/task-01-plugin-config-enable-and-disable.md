---
title: "`ahpd plugin config`, `enable` and `disable`"
status: todo
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/commands/plugin.ts#L81-L135](../../../../packages/server/src/commands/plugin.ts#L81-L135) - `plugin install`, the shape"
  - "[code://packages/server/src/install.ts#L137-L223](../../../../packages/server/src/install.ts#L137-L223) - the file helpers"
---

## Objective

`plugin.config`, `plugin.enable` and `plugin.disable` exist on the CLI and over HTTP as the plugin table in the plan says, and a served answer masks `writeOnly` values.

## Files

- `UPDATE: packages/server/src/commands/plugin.ts` - the three actions, in `oneAtATime`.
- `UPDATE: packages/server/src/install.ts` - an entry's `options` and `enabled` set and unset.
- `UPDATE:` the server command, CLI and HTTP tests.

## Steps

1. Tests first in a temp config directory: show, get, set, unset, a refused value naming the option, enable and disable of a string spec and of an object spec, a name not configured refused, the served answer masking a `writeOnly` option.
2. Implement.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume
