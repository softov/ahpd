---
title: A plugin opens an in-memory connection to its host
status: done
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

- `packages/sdk/src/pair.ts` is new: `createPair()` answers a `Pair` - `host` (the `Peer` handed to `Host.accept`), `plugin` (the end the plugin keeps), `served(connection)` and `close()`. Each `send` is the other end's input through `receive`, delivered on one `setTimeout(..., 0)`, so a socket's asynchrony is kept and a plugin cannot settle its own question inside its own turn.
- A frame with no `method` goes to `pluginPeer.answered` and one with a `method` to `onMessage`, which is the rule `receive` itself uses - both counters start at the same place, so reading a host question as an answer would settle a promise about something else and leave the real question waiting out its timeout.
- Both ends close together and once: `shut()` is guarded, closes the two peers and hands the host's connection back through its own `close`, which is what takes the connection out of the host's set, stops its turns being attributed to it and tells every client it went. `handle` before `served` throws `-32601` rather than answering nothing.
- `packages/sdk/src/types/plugin.ts` gains `PluginPeer` (`send`, `notify`, `request`, `onMessage`, `close`), `PluginConnects` (`by`, `host?`, `close()`) and `PluginHost.connect(): PluginPeer`; `Contribution.connects` is required, because the fold reads it without a case, as it reads `starts`.
- `pluginHost` keeps the open pairs in a closed-over `opened` list and answers `connect()` with a fresh pair served by `host.accept(pair.host, principal)`. With `connects.host` absent it throws `miss(by, 'connect', 'a connection', 'asked for once a host is built over this plugin; connect from `listening` or later')`.
- `foldHostOptions` carries `options.pluginConnects`, one entry per contribution, whole and unnamed, exactly as `pluginStarts` is - connecting is not a claim on a name two plugins could disagree about. `HostOptions.pluginConnects` is new in `types/host.ts`, and `types/index.ts` exports `PluginPeer` and `PluginConnects`.
- `run.ts` sets `one.host = host` on every entry the moment `createHost` answers, and closes every one of them on `down` after `stopping` is raised and before the listeners go.
- `packages/server/test/plugin-connect.test.ts` is new, with the fixture `packages/server/test/fixtures/plugin-connect/index.ts`: the plugin connects at `listening`, `initialize`s itself, opens a session of the `echo` backend and sends a turn once a client that is not itself is in the room. The test reads the plugin's own account off the daemon's log, since a loaded fixture cannot be asked directly.
- **Departure 1.** `HostOptions.pluginConnects` and the `Contribution.connects` field are not named by this task's Files list, which stops at `pluginHost` and `run.ts`. The field is how the built host reaches the plugin, and the daemon is the only thing that can set it, so it has to be on the options rather than held by the plugin.
- **Departure 2.** `packages/sdk/test/plugin-fold.test.ts` and `packages/sdk/test/plugin-host.test.ts` gained `connects: { by, close: () => {} }` on their `Contribution` fixtures. The field is required, so every fixture constructing one is otherwise a compile error; no test case was added or retitled.
- Verified: `npx vitest run --maxWorkers=2 --testTimeout=10000` green over the whole repository (272 files, 4842 tests), `pnpm typecheck`, `pnpm boundary` green.
