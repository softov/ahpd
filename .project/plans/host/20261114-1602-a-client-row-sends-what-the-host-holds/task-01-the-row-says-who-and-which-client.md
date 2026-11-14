---
title: The row says who and which client
status: todo
depends: []
layer: "sdk host, sdk clients, docs"
refs:
  - "[code://packages/sdk/src/types/host.ts#L179-L200](../../../../packages/sdk/src/types/host.ts#L179-L200) - `ConnectedClient`, which gains the fields"
  - "[code://packages/sdk/src/host.ts#L461-L464](../../../../packages/sdk/src/host.ts#L461-L464) - `clientNames`, the map `clientInfos` copies"
  - "[code://packages/sdk/src/host.ts#L1973-L1984](../../../../packages/sdk/src/host.ts#L1973-L1984) - `clientRow`, which copies the fields"
  - "[code://packages/sdk/src/host/context.ts#L189](../../../../packages/sdk/src/host/context.ts#L189) - `clientVersions` on the context, beside which `clientInfos` goes"
  - "[code://packages/sdk/src/host/handshake.ts#L344-L348](../../../../packages/sdk/src/host/handshake.ts#L344-L348) - `initialize`, which reads `clientInfo`"
  - "[code://packages/sdk/src/host/handshake.ts#L121-L134](../../../../packages/sdk/src/host/handshake.ts#L121-L134) - `attached`, which forgets the maps"
  - "[code://packages/sdk/src/clients/channel.ts#L91-L101](../../../../packages/sdk/src/clients/channel.ts#L91-L101) - `rowOf`, which reshapes `principal`"
---

## Objective

A row says whether the socket is the host itself, when its sign-in runs out, and the person's roles and team.
It also says the client's version, title and capabilities.

## Files

- `UPDATE: packages/sdk/src/types/host.ts:179-200` - add `root`, `principalUntil`, `clientVersion`, `clientTitle` and `capabilities` to `ConnectedClient`, each optional and documented.
- `UPDATE: packages/sdk/src/host.ts:461-464` - add `clientInfos`, a map by client id of `{ version?, title?, capabilities? }`.
- `UPDATE: packages/sdk/src/host.ts:1973-1984` - `clientRow` copies `root`, `principalUntil` and the client's `clientInfos` entry.
- `UPDATE: packages/sdk/src/host.ts:1578` - pass `clientInfos` to the handshake context.
- `UPDATE: packages/sdk/src/host/context.ts:189` - declare `clientInfos` beside `clientVersions`.
- `UPDATE: packages/sdk/src/host/handshake.ts:344-348` - keep `clientInfo.version`, `clientInfo.title` and the names of `capabilities` in `clientInfos`.
- `UPDATE: packages/sdk/src/host/handshake.ts:121-134` - forget `clientInfos` with the other maps.
- `UPDATE: packages/sdk/src/clients/channel.ts:91-101` - `rowOf` adds `roles` and `team` from `principal` beside its id.
- `UPDATE: packages/sdk/test/host-handshake.test.ts` - cases for the new fields after a real handshake.
- `UPDATE: packages/sdk/test/clients-channel.test.ts` - cases for `roles`, `team` and `root` on a row.
- `UPDATE: docs/plugins/PLUGINS.md:1876` - name the new fields, and say `clientVersion`, `clientTitle` and `capabilities` are the client's claims.

## Steps

1. Add the five optional fields to `ConnectedClient`, with one doc line each.
2. Add `clientInfos` beside `clientNames` in `host.ts`, and pass it through the handshake context.
3. In `initialize`, read `bag(params.clientInfo)` for a string `version` and `title`.
4. In `initialize`, read `bag(params.capabilities)` and keep the keys whose value is an object.
5. Set the `clientInfos` entry when any of the three is present, and delete it otherwise.
6. Delete the `clientInfos` entry in `attached`, beside the delete of `clientNames`.
7. In `clientRow`, copy `root` when true and `principalUntil` when present.
8. In `clientRow`, spread the client's `clientInfos` entry as `clientVersion`, `clientTitle` and `capabilities`.
9. In `rowOf`, add `roles` when not empty and `team` when present.
10. Write the tests that *Validation* lists.
11. Update the `x-ahpd-clients` section of `PLUGINS.md`.
12. Start a test daemon, connect ahpc at f20c948, and read its row for `name`.
13. Fix a host cause of a missing `name` in this task, and add a test.

## Validation

- `packages/sdk/test/host-handshake.test.ts`: a row after `initialize` with `clientInfo: { name, version, title }` carries `clientVersion` and `clientTitle`.
- `packages/sdk/test/host-handshake.test.ts`: a row after `initialize` with `capabilities: { mcpApps: {} }` carries `capabilities: ['mcpApps']`.
- `packages/sdk/test/host-handshake.test.ts`: the same client after `reconnect` keeps `clientVersion`, `clientTitle` and `capabilities`.
- `packages/sdk/test/host-handshake.test.ts`: a socket accepted with `root` carries `root: true`, and one without carries no `root`.
- `packages/sdk/test/clients-channel.test.ts`: a principal with roles and a team gives a row with `principal` as the id, `roles` and `team`.
- `pnpm --filter @ahpd/sdk test` passes.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.
- By hand: ahpc's row on a test daemon carries `name: 'ahpc'`, or *Resume* names the cause.

## Resume
