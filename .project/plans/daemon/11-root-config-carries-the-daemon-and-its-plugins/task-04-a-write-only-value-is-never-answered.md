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

A value whose schema property has `writeOnly: true` is `<set>` in root state, in `GET /api/config`, in `GET /api/plugin/list` and in `POST /api/plugin/config`; every other option is answered as the file holds it; `connectionToken` and a spec URL's userinfo stay `<set>`; our plugins' credentials are `writeOnly`.
The served `plugin list` and `daemon.config` show the values that are not `writeOnly` as `plugin config` already does, so the three answer through one mask; a plugin whose schema cannot be read, or which is switched off and so never imported, answers every value as `<set>`, as `plugin config` does.

## Files

- `UPDATE: packages/server/src/commands/config.ts` and `packages/server/src/commands/plugin.ts` - one mask by schema, used by every served answer.
- `UPDATE: packages/server/src/rootconfig.ts` - the same mask.
- `UPDATE:` every `optionsSchema` in `packages/*/src` that has a credential, `agent-cofold`'s `apiKey` first.
- `UPDATE:` the served config and plugin list tests.

## Steps

1. Tests first: a `writeOnly` option is `<set>` in the three answers and absent when unset; a plain option shows its value in the served `plugin list` and `daemon.config` as in `plugin config`; a switched-off plugin is not imported and its values are `<set>`; `ahpd config` at the terminal prints the file.
2. Implement; list each plugin option marked in the task's Resume.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume
