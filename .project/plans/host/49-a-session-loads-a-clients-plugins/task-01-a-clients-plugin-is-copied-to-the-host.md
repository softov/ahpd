---
title: A client's plugin is copied to the host
status: done
depends: []
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/host/relay.ts#L65-L93](../../../../packages/sdk/src/host/relay.ts#L65-L93) - `clients.list` and `clients.read`, the two calls a copy makes"
  - "[code://packages/sdk/src/types/host.ts#L68-L276](../../../../packages/sdk/src/types/host.ts#L68-L276) - `HostOptions`, where the port goes beside `changes` and `computers`"
  - "[code://packages/server/src/config.ts#L379](../../../../packages/server/src/config.ts#L379) - `sessionsDir`, the shape of `agentPluginsDir`"
  - "[code://packages/server/src/commands/run.ts#L420](../../../../packages/server/src/commands/run.ts#L420) - where the server hands the host its ports"
  - "[code://packages/sdk/test/clients.test.ts](../../../../packages/sdk/test/clients.test.ts) - a fake client answering resource requests"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/agentPluginManager.ts#L22-L191 - the copy, the keys, the nonce cache and the limits"
---

## Objective

`ClientPlugins.sync(client, plugins)` answers each plugin's local directory, or the error that kept it from one; a plugin is copied from the client once per nonce into `<dir>/<uri key>/<nonce key>/`, and the directory keeps at most 64 copies in all and 8 per plugin.

## Files

- `CREATE: packages/sdk/src/types/clientplugins.ts` - `ClientPlugins` and `SyncedPlugin { uri, nonce?, path } | { uri, nonce?, error }`.
- `CREATE: packages/sdk/src/clientplugins.ts` - `clientPluginsIn(dir, clients)`: keys as VS Code sanitizes them (non-alphanumerics to `-`, 128 characters, `default` for no nonce); a copy walks `clients.list` and writes each `clients.read` into a temporary directory renamed into place; a hit on an existing `(uri, nonce)` copies nothing; the order of use is kept in `<dir>/lru.json`, and the oldest copies past the limits are removed, a directory that will not go being left.
- `UPDATE: packages/sdk/src/types/host.ts` - `HostOptions.clientPlugins?: ClientPlugins`.
- `UPDATE: packages/sdk/src/index.ts` - the export.
- `UPDATE: packages/server/src/config.ts`, `packages/server/src/commands/run.ts` - `agentPluginsDir()` as `join(configDir(), 'agentPlugins')`, and the port built over it.
- `CREATE: packages/sdk/test/clientplugins.test.ts` - the cases below.

## Steps

1. Declare the port and the result type.
2. Write the file implementation; a `file:` URI already under `dir` is answered as its own path with no copy.
3. Wire the server.

## Validation

- `packages/sdk/test/clientplugins.test.ts`, in a temp directory with a fake `clients` serving a plugin of two files and a subfolder: the first sync writes all three under `<uri key>/<nonce key>/` and answers that path; a second sync with the same nonce reads nothing from the client; a new nonce copies again; nine nonces of one plugin leave eight; a client that fails a read answers an error and leaves no partial directory; a `file:` URI under the directory is answered as is; a new port over the same directory finds the earlier copies through `lru.json`.
- `pnpm test` passes.

## Resume

## Outcome

`ClientPlugins` and its two result shapes are in `packages/sdk/src/types/clientplugins.ts`, declaration-only, and `clientPluginsIn(dir, clients)` is in `packages/sdk/src/clientplugins.ts`, exported from `packages/sdk/src/index.ts`. A copy walks `clients.list` and writes each `clients.read` into `<at>.building` beside the name it is moved to; `rmSync` then `renameSync` makes the copy whole or leaves nothing, and a failed copy also removes the per-plugin key directory it was the first to make. `lru.json` holds the order of use oldest-first, and `load()` re-derives each path from the two names rather than trusting a path read from the file. `HostOptions.clientPlugins` sits after `mcpServers` in `packages/sdk/src/types/host.ts`; `agentPluginsDir()` is in `packages/server/src/config.ts` and the port is built over it in `packages/server/src/commands/run.ts`. `packages/sdk/test/clientplugins.test.ts` covers the nine cases in Validation and passes.

Two things the plan left open. `types/index.ts` gained one re-export line for the three new types, a file no task names. And the port is built with `clientPluginsIn(agentPluginsDir(), () => host.clients)` in `run.ts`, a thunk rather than `host.clients`, because the options object is built before `createHost` is called and the port is only ever asked afterwards.
