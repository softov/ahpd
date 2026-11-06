---
title: The plugins channel installs and removes
status: done
depends: [task-01-one-install-path-takes-every-source.md]
layer: "server, sdk, docs"
refs:
  - "[code://packages/server/src/pluginschannel.ts#L368-L419](../../../../packages/server/src/pluginschannel.ts#L368-L419) - `apply`, `reload` and the methods map"
  - "[code://packages/server/src/commands/plugin.ts#L220-L275](../../../../packages/server/src/commands/plugin.ts#L220-L275) - the HTTP install and remove, with `deploymentTokenOnly`"
  - "[code://packages/server/src/commands/scopes.ts#L14-L27](../../../../packages/server/src/commands/scopes.ts#L14-L27) - the comment that says why a person may not install"
  - "[code://packages/sdk/src/access/users.ts#L26-L35](../../../../packages/sdk/src/access/users.ts#L26-L35) - the built-in roles"
  - "[code://packages/server/test/plugins-channel.test.ts](../../../../packages/server/test/plugins-channel.test.ts) - the channel tests"
---

## Objective

`x-ahpd/plugins/install` takes `{ source }` and `x-ahpd/plugins/remove` takes `{ id, keep? }`.
Both need the grant `plugin:install`, which only `admin` holds.
`POST /plugin/install` and `/plugin/remove` take the same grant in place of the deployment token.
Each command answers when npm ends, then applies the change, with `restart: true` for a plugin with a port.

## Files

- `UPDATE: packages/server/src/pluginschannel.ts:368-419` - add `install` and `remove`, which call the install path and then `applyPlugins`.
- `UPDATE: packages/server/src/commands/plugin.ts:220-275` - the scope `plugin:install` in place of `config:write` and `deploymentTokenOnly`, for install and remove only.
- `UPDATE: packages/server/src/commands/scopes.ts:14-27` - say that install and remove need `plugin:install`, which gives the daemon's permissions.
- `UPDATE: packages/server/test/plugins-channel.test.ts` - the cases below.
- `UPDATE: docs/plugins/PLUGINS.md:1222-1224` - the two commands and the grant.
- `UPDATE: docs/sdk/USERS.md` - `plugin:install`, and that it gives the daemon's permissions.

## Steps

1. Add `install`, which takes one `source` string and calls the install path from task 01.
2. Add `remove`, which takes `id` and an optional `keep`, and calls `removePlugins`.
3. Call `applyPlugins` after each one, as `enable` does.
4. Answer `{ id }`, with `restart: true` when a plugin with a port is in the way.
5. Run one install or remove at a time, with `oneAtATime`, as the CLI does.
6. Change the scope of the HTTP install and remove to `plugin:install`.
7. Keep `deploymentTokenOnly` on update, options and restart.
8. Write the new grant in the docs.
9. Run the gate, then restore `packages/sdk/test/fixtures/wire.jsonl`.

## Validation

- A test installs a source as an admin, and the plugins channel lists the new row.
- A test refuses `install` and `remove` for a `member`.
- A test removes a plugin, and the row leaves the channel.
- A test sends `POST /plugin/install` with an admin token, and the fake npm runs.
- A test shows that `POST /plugin/update` still refuses an admin token.
- The gate passes.
