---
title: The daemon keeps the tunnels
status: todo
depends:
  - task-02-the-host-lists-tunnels-and-runs-ops.md
layer: server
refs:
  - "[code://packages/server/src/commands/run.ts#L805](../../../../packages/server/src/commands/run.ts#L805) - the connectors collection, which the tunnels collection sits beside"
  - "[code://packages/server/src/commands/run.ts#L836-L862](../../../../packages/server/src/commands/run.ts#L836-L862) - `connectorsChannel` wired with the vault and the check, which `tunnelsChannel` copies"
  - "[code://packages/server/src/commands/run.ts#L962-L963](../../../../packages/server/src/commands/run.ts#L962-L963) - the channels and methods the host serves"
  - "[code://packages/server/src/commands/run.ts#L1525](../../../../packages/server/src/commands/run.ts#L1525) - where the folded adapters are taken, which the kinds copy at each fold"
  - "[code://packages/server/src/commands/run.ts#L1850-L1856](../../../../packages/server/src/commands/run.ts#L1850-L1856) - `listening` raised"
  - "[code://packages/server/src/commands/run.ts#L1667](../../../../packages/server/src/commands/run.ts#L1667) - the routes' `Host` check"
  - "[code://packages/server/src/commands/run.ts#L580](../../../../packages/server/src/commands/run.ts#L580) - the API's `Host` and `Origin` check"
  - "[code://packages/server/src/config.ts#L192-L200](../../../../packages/server/src/config.ts#L192-L200) - `origins`, which `tunnelHosts` sits beside"
---

## Objective

The daemon keeps the tunnels in a `tunnels` collection, serves `x-ahpd-tunnels://`, and starts the tunnels after `listening`.
The routes answer to each tunnel's URL. The API does so only when `tunnelHosts` is on.

## Files

- `UPDATE: packages/server/src/commands/run.ts:805` - open the `tunnels` collection as JSON.
- `UPDATE: packages/server/src/commands/run.ts:836-862` - build `tunnelsChannel` over the collection, the kinds, the vault and the check.
- `UPDATE: packages/server/src/commands/run.ts:962-963` - serve the channel, its methods and `x-ahpd/invokeOperation`.
- `UPDATE: packages/server/src/commands/run.ts:1525` - take the folded kinds at each fold, as the adapters are taken.
- `UPDATE: packages/server/src/commands/run.ts:1850-1856` - call `startAll` with the bound port after `listening`, and `stopAll` at `stopping`.
- `UPDATE: packages/server/src/commands/run.ts:1667` - add the list's URLs to the routes' names.
- `UPDATE: packages/server/src/commands/run.ts:580` - add the list's URLs to the API's names when `tunnelHosts` is on.
- `UPDATE: packages/server/src/config.ts:192-200` - `tunnelHosts`, a boolean, false by default.
- `UPDATE: packages/server/src/records.ts:35` - check that `tunnels` is not a reserved collection, and leave it out of the set.
- `CREATE: packages/server/test/tunnels.test.ts` - the daemon with a fake kind plugin.
- `UPDATE: docs/CONFIG.md` - `tunnelHosts`.

## Steps

1. Open the `tunnels` collection with `format: 'json'`, as for the connectors collection.
2. Build `tunnelsChannel` beside `connectorsChannel`, with the same vault getter and schema check.
3. Read the kinds through a getter, so a kind folded after the load reaches the channel.
4. Serve the channel and its methods with the connectors channel's.
5. Serve `x-ahpd/invokeOperation` as a host method, with `x-ahpd-tunnels://` as its one channel now.
6. Take the folded kinds at each fold, beside the adapters.
7. After `listening`, call `startAll` with the bound port.
8. Call `stopAll` before the plugins hear `stopping`.
9. Keep the tunnels of a plugin that is off, with `status: stopped`.
10. Add each URL from `urls()` to the routes' `authorities`, as host and as hostname, as `announcedNames` does.
11. Add the same names to the API's names only when `tunnelHosts` is true.
12. Read `tunnelHosts` from the config, check it is a boolean, and default it to false.
13. Write `tunnelHosts` in `docs/CONFIG.md`.

## Validation

- `packages/server/test/tunnels.test.ts` holds: a fake kind's system tunnel is in `x-ahpd-tunnels://` after `listening`, with `purpose: system`.
- The same file holds: an enabled tunnel starts with the daemon, and a tunnel that is off does not.
- The same file holds: the routes answer to a tunnel's URL.
- The same file holds: the API answers to a tunnel's URL only with `tunnelHosts` on.
- The same file holds: `stopAll` runs before the plugins hear `stopping`.
- `pnpm --filter @ahpd/server test -- tunnels` passes.
- `pnpm typecheck` and `pnpm boundary` pass.

## Resume
