---
title: The host lists every grant it uses
status: todo
depends: [task-01-a-plugin-registers-its-grants.md]
layer: "sdk, server, bot"
refs:
  - "[code://packages/sdk/src/access/users.ts#L183-L194](../../../../packages/sdk/src/access/users.ts#L183-L194) - the `plugin` row"
  - "[code://packages/sdk/src/clients/channel.ts#L42-L44](../../../../packages/sdk/src/clients/channel.ts#L42-L44) - the grants of the clients list"
  - "[code://packages/sdk/src/tunnels/channel.ts#L255-L316](../../../../packages/sdk/src/tunnels/channel.ts#L255-L316) - the grants of the tunnels list"
  - "[code://packages/bot/src/provider.ts#L374](../../../../packages/bot/src/provider.ts#L374) - `bot:chat`"
  - "[code://packages/server/src/pluginschannel.ts#L788-L806](../../../../packages/server/src/pluginschannel.ts#L788-L806) - `plugin:apply` and `plugin:reload`"
---

## Objective

`ahpd.grants` lists every grant the host and the bot plugin require today.
A role may hold `plugin:apply` and `plugin:reload`, and `plugin:write` holds both.

## Files

- `UPDATE: packages/sdk/src/access/users.ts:183-194` - `apply` and `reload` in the operations and the `write` group of `plugin`.
- `UPDATE: packages/server/src/commands/run.ts` - the daemon passes `grants` for `client` and `tunnel`, where it builds those channels.
- `UPDATE: packages/bot/src/plugin.ts` - the bot plugin calls `registerGrants('bot', { operations: ['chat'] })`.
- `UPDATE: docs/sdk/USERS.md:100-117` - rows for `client` and `tunnel`, and `apply` and `reload` in the `plugin` row.
- `UPDATE: packages/sdk/test/users.test.ts` - `plugin:apply` and `plugin:reload` in a role.
- `UPDATE: packages/server/test/plugins-channel.test.ts` - a role with `plugin:write` applies and reloads.

## Steps

1. Add `apply` and `reload` to the operations and the `write` group of the `plugin` row of `OPERATIONS`.
2. In `run.ts`, add `grants` to the host options: `client` with `drop`, and `tunnel` with `put` and `delete`.
3. Give the `client` and `tunnel` entries a title and a one-sentence description, in the words of their channels' `describe`.
4. Call `registerGrants('bot', { operations: ['chat'] })` where the bot plugin registers its resource provider.
5. Find the place where the bot plugin activates with `rg "registerResourceProvider" packages/bot/src`.
6. Update the rows of `docs/sdk/USERS.md`.

## Validation

- `packages/sdk/test/users.test.ts`: `grantProblem` accepts `plugin:apply` and `plugin:reload`, and `holds` answers both for `plugin:write`.
- `packages/server/test/plugins-channel.test.ts`: a person whose role holds `plugin:write` calls `x-ahpd/plugins/apply` and `x-ahpd/plugins/reload`.
- A server test reads `ahpd.grants` from the root. It finds `client`, `tunnel`, `bot` with `chat`, and `plugin` with `apply` and `reload`.
- `pnpm typecheck`, `pnpm --filter @ahpd/sdk test`, `pnpm --filter @ahpd/server test` and `pnpm --filter @ahpd/bot test` pass.

## Resume

