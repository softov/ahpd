---
title: Plugins and connectors have their own grants
status: done
depends: [task-04-a-client-lists-the-plugins.md, task-07-a-client-makes-connectors.md]
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/access/users.ts#L123-L220](../../../../packages/sdk/src/access/users.ts#L123-L220) - `OPERATIONS`, the subjects the host decides, with their read and write groups"
  - "[code://packages/server/src/commands/plugin.ts#L352-L414](../../../../packages/server/src/commands/plugin.ts#L352-L414) - the HTTP plugin commands, which take the deployment token today"
  - "[code://packages/server/src/commands/scopes.ts#L46](../../../../packages/server/src/commands/scopes.ts#L46) - `deploymentTokenOnly`, the HTTP check"
  - "[code://packages/server/src/pluginschannel.ts#L150-L273](../../../../packages/server/src/pluginschannel.ts#L150-L273) - the channel and its commands, which take `config:read` and `config:write` today"
  - "[code://packages/sdk/src/connectors/channel.ts](../../../../packages/sdk/src/connectors/channel.ts) - the connectors channel, which takes `config:read` and `config:write` today"
---

## Objective

A role gives access to plugins and to connectors without a `config` grant.
The protocol and HTTP require the same grant for the same plugin command.
Install, update and remove stay with the deployment token.

## Files

- `UPDATE: packages/sdk/src/access/users.ts:123-220` - add the `plugin` and `connector` subjects.
- `UPDATE: packages/server/src/pluginschannel.ts:150-273` - the channel and its commands require `plugin:` grants.
- `UPDATE: packages/server/src/commands/plugin.ts:352-414` - enable, disable and the options commands require `plugin:` grants, without `deploymentTokenOnly`.
- `UPDATE: packages/sdk/src/connectors/channel.ts` - the channel and its commands require `connector:` grants.
- `UPDATE: packages/server/test/plugins-channel.test.ts` - the plugin cases below.
- `UPDATE: packages/sdk/test/connectors-channel.test.ts` - the connector cases below.

## Steps

1. Add the `plugin` subject: `list` in the read group, and `enable`, `disable` and `options` in the write group.
2. Add the `connector` subject: `list` in the read group, and `put` and `remove` in the write group.
3. Require `plugin:list` to read `x-ahpd-plugins`.
4. Require `plugin:enable`, `plugin:disable` and `plugin:options` for the three plugin commands.
5. Require the same grants for the same commands over HTTP, and remove their `deploymentTokenOnly`.
6. Keep `deploymentTokenOnly` on install, update and remove.
7. Require `connector:list` to read every row of `x-ahpd-connectors`.
8. Require `connector:put` and `connector:remove` for a connector owned by `host`.
9. Keep the rules for a person's own connectors and their team's connectors.
10. Run the SDK and server tests, and set this task and the plan row to `implemented`.

## Validation

- `plugins-channel.test.ts`: a role with `plugin:read` reads the channel, and the host refuses a role with only `config:read`.
- `plugins-channel.test.ts`: a role with `plugin:enable` enables a plugin over the protocol and over HTTP.
- `plugins-channel.test.ts`: a role with `plugin:write` but not the deployment token cannot install a plugin over HTTP.
- `connectors-channel.test.ts`: a role with `connector:read` reads every row, and the host refuses a role with only `config:read`.
- `connectors-channel.test.ts`: a role with `connector:put` makes a `host` connector, and the host refuses `config:write` alone.
- `connectors-channel.test.ts`: a person still makes their own connector with no grant.
- The handshake's `ahpd.grants` lists `plugin` and `connector` with their operations.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass.

## Resume

- **Done so far:** the `plugin` and `connector` subjects are in `OPERATIONS`, and both channels and their commands require them.
  `plugin:list` reads the plugin channel; `plugin:enable`, `plugin:disable` and `plugin:options` write it, and `connector:list` reads the connector channel while `connector:put` and `connector:remove` write it.
  Over HTTP the options commands and `enable` and `disable` take the same `plugin:` grants with no deployment token, and install, update and remove keep it.
  A host connector takes `connector:put` and `connector:remove`, a team's keeps `team:write` with a membership, and a person's own connector still takes nothing but being them.
  The handshake lists both subjects with their operations.
  The plugin channel's tests cover the answers over the protocol and over HTTP, and the connectors channel's cover the same reads and writes.
- **Next action:** task 13: the plugin and connector docs, and the changelog's break.
- **Open questions:** none.
- **Departures:** `docs/sdk/USERS.md` gained the `plugin` and `connector` rows, and its two "eleven" counts became "thirteen", in this task rather than in task 13.
  The SDK's `users.test.ts` refuses a subject with no row on that page, and this task's gate runs it.
  `users.test.ts` used `plugin:something` as its example of a grant on a subject the table does not decide.
  It now uses `notes:something`, because `plugin` is a table subject.
  In `server-http.test.ts` the two `config:read` expectations for `plugin/list` now say `plugin:list`, and the loop that covered `status` and `plugin/list` together names each command's grant.
  In review, moving a `host` connector to a new owner takes `connector:remove`, because the move removes it from the host.
- **Watch out for:** a role that held `config:read` for these channels loses them; the changelog says which grant to add.
