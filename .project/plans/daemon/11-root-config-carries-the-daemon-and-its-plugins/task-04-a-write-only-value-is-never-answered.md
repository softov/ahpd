---
title: A write-only value is never answered
status: todo
depends: [task-03-each-plugin-is-a-key.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/config.ts#L24-L44](../../../../packages/server/src/commands/config.ts#L24-L44) - `withoutOptionValues` and `withoutSecrets`"
  - "[code://packages/server/src/commands/plugin.ts#L36-L43](../../../../packages/server/src/commands/plugin.ts#L36-L43) - a served `plugin list` row"
---

## Objective

A value whose schema property has `writeOnly: true` is `<set>` in root state, in `GET /api/config` and in `GET /api/plugin/list`; every other option is answered as the file holds it; `connectionToken` and a spec URL's userinfo stay `<set>`; our plugins' credentials are `writeOnly`.

## Files

- `UPDATE: packages/server/src/commands/config.ts` - one mask by schema, used by all three answers.
- `UPDATE: packages/server/src/rootconfig.ts` - the same mask.
- `UPDATE:` every `optionsSchema` in `packages/*/src` that has a credential, `agent-cofold`'s `apiKey` first.
- `UPDATE:` the served config and plugin list tests.

## Steps

1. Tests first: a `writeOnly` option is `<set>` in the three answers and absent when unset; a plain option shows its value; `ahpd config` at the terminal prints the file.
2. Implement; list each plugin option marked in the task's Resume.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume
