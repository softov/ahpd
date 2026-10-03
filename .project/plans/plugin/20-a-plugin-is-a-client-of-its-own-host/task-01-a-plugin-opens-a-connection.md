---
title: A plugin opens an in-memory connection to its host
status: todo
depends: []
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L139-L279](../../../../packages/sdk/src/types/plugin.ts#L139-L279) - `PluginHost`"
  - "[code://packages/sdk/src/types/rpc.ts#L34-L59](../../../../packages/sdk/src/types/rpc.ts#L34-L59) - `Peer`"
  - "[code://packages/sdk/src/types/host.ts#L753](../../../../packages/sdk/src/types/host.ts#L753) - `Host.accept`"
  - "[code://packages/sdk/src/plugins.ts#L299](../../../../packages/sdk/src/plugins.ts#L299) - `pluginHost`"
  - "[code://packages/server/src/commands/run.ts#L639](../../../../packages/server/src/commands/run.ts#L639) - where the host is built"
---

## Objective

`PluginHost.connect()` answers the plugin's end of an in-memory connection to the host: `request`, `notify` and `onMessage`, served by `Host.accept`.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts:139-279` - `connect()` and the type of the end it answers, documented.
- `CREATE: packages/sdk/src/pair.ts` - an in-memory pair: the host's `Peer` and the plugin's end.
- `UPDATE: packages/sdk/src/plugins.ts:299` - `pluginHost` takes a late binding to the built host.
- `UPDATE: packages/server/src/commands/run.ts:639` - binds the host once `createHost` returns, and closes open connections at `stopping`.
- `CREATE: packages/server/test/plugin-connect.test.ts` - the cases below.

## Steps

1. Build the pair so a message sent on one end is received on the other, asynchronously, as a socket would deliver it.
2. `connect()` calls `Host.accept` with the host's end and wires `handle` and `close`; the principal is task 02's, and until then none.
3. Called before the host is built, `connect()` throws a sentence naming the plugin and saying to connect from `listening` or later.
4. The daemon closes every connection a plugin opened when `stopping` is raised.

## Validation

- `packages/server/test/plugin-connect.test.ts`: a fixture plugin connects at `listening`, sends `initialize`, `createSession` and a message, and receives the session's actions; `connect()` during `apply` throws.
- `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.

## Resume

