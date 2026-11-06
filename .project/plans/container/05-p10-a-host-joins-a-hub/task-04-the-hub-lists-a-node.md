---
title: The hub lists a node as a computer
status: done
depends: [task-02-a-joined-socket-is-a-nested-host.md]
layer: "computer"
refs:
  - "[code://packages/sdk/src/plugins/plugins.ts#L292-L295](../../../../packages/sdk/src/plugins/plugins.ts#L292-L295) - one `computers` port"
  - "[code://packages/computer/src/plugin.ts#L1448-L1787](../../../../packages/computer/src/plugin.ts#L1448-L1787) - the port the plugin registers"
---

## Objective

`@ahpd/computer` serves a `node` runtime through p9's router that lists the hub's nodes (status `running` while connected, which `isRunning` reads as up), answers `remote` true and `connect` through the registry, and refuses every verb that would make, start or stop one.

## Files

- `CREATE: packages/computer/src/node.ts` - the runtime, reading the registry the host hands plugins.
- `UPDATE: packages/sdk/src/types/host.ts` - the node registry on the plugin host, read-only.
- `UPDATE: packages/computer/src/plugin.ts` - registered with the router; `connect` on the port.

## Steps

1. A node's id is `node.<name>`, through p9 task 01's `spellMachineId`.
2. A node is owned by the host and its up time is metered from the registry's connect and drop events: a stretch opens when its control socket connects and closes when it drops. p9 task 01's metering function for a runtime that only lists takes reachability events, and a listing is one source of them; the node registry is another, so a node is metered exactly and not only when a listing runs.
3. Send no model key in the nested start, because the node uses its own configuration.

## Validation

- `computer-plugin.test.ts`: a registry with one connected node lists `node.<name>`; `connect` reaches the registry; `remote` is true.
- The same file: a node that connects and then drops writes one stretch charged to the host, with no listing between the two events.

## Resume

- **Implemented** 2026-10-30.
- `packages/sdk/src/types/host.ts` holds `NodeRegistry`: `joined()`, `connect(id, asked)` and `watch(onChange)`, with `JoinedNode` and `NodeChange` beside it, and `HostOptions.nodes` carries it. `PluginHost.nodes` is the same read-only handle, so a plugin lists nodes and never adds one.
- `packages/sdk/src/nodes.ts` implements `watch`: it says a node joined at the hello that named its workdir, says it left at a real control close or at `drop`, and tells a watcher taken later where each connected node already is. A node that dialled again is one node, so its stretch does not restart, and a watcher that throws is logged rather than allowed to stop the ones after it. This file is not in the task's file list.
- The registry reaches a plugin through `HostRecordingOptions.nodes` in `packages/sdk/src/plugins/plugins.ts` and `LoaderOptions.nodes` in `packages/server/src/plugins.ts`, and `packages/server/src/commands/run.ts` sets it on the daemon's base from the registry it already builds. That last file is not in the task's file list either.
- `packages/computer/src/node.ts` is the runtime: `kind` and `NODE_RUNTIME` are `node`, `remote` is true, and `list` answers one row per connected node with status `running`, no image and no created moment. `inspect` answers the node's name and workdir, `agents` answers an empty list so every agent may run there, `parts` and `owner` answer as an ssh box does, and `how` and `hostCommand` answer nothing. `run`, `start`, `stop`, `restart`, `remove`, `exec`, `putIn` and `takeOut` refuse with a sentence, and `bringBack`, `follow` and `stats` do nothing.
- `packages/computer/src/plugin.ts` builds that runtime only when `host.nodes` exists, adds it to the router's runtimes, and registers `connect` on the port: only an id whose runtime is `node` reaches the registry, with the name alone, and every other id answers `undefined` so the proxy starts the host the old way.
- Metering subscribes to the registry's watch right after `listingMeter`, spelled into `node.<name>`, and the subscription is closed through `host.registerClose`. A node is charged to `root:<hostName>`, as p9's listing meter charges an ssh box. A listing feeds the same two events, which is harmless: the book ignores a stretch already open and a close for one it does not hold.
- Step 3 is already what task 02 built: `node/open` carries `{ id, plugins }` and nothing else, so no model, folder or credential is sent. The folder a session works in is the node's own `workdir`, which `connect` answers as `NestedStarted.workingDirectory`.
- `packages/computer/test/computer-plugin.test.ts` has two cases: a joined node is listed as `node.box`, `remote` is true, only the node's id reaches the registry and a node that left is neither listed nor connectable; and join-then-leave writes one `computer` entry for `node.box` owned by `root:box.local`.
- `packages/sdk/test/nodes.test.ts` has one more case for `watch`: a join, a late watcher's replay, one departure, and a watcher that closed hearing nothing.
- Verified: typecheck clean; `computer-plugin.test.ts` 25 passed and `nodes.test.ts` 5 passed with `--testTimeout=20000`, since the file's docker-fixture cases pass 5 s under load; `computer-runtimes.test.ts` and `computer-uptime.test.ts` 17 passed; `plugin-host`, `plugin-fold`, `plugin-load`, `server-commands`, `server-cli` and `join` 207 passed.
- `packages/sdk/src/types/index.ts` exports the three new types.
