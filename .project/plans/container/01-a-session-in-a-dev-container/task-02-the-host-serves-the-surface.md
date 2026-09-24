---
title: The host serves the dev container surface
status: done
depends: []
layer: packages/sdk
refs:
  - "[code://packages/sdk/src/host.ts#L4547-L4600](../../../../packages/sdk/src/host.ts#L4547-L4600) - `accept`, where a connection is made and its own state begins"
  - "[code://packages/sdk/src/host.ts#L4686-L4760](../../../../packages/sdk/src/host.ts#L4686-L4760) - `capabilityFor` and the per-connection `handlers`"
  - "[code://packages/sdk/src/host.ts#L4825-L4845](../../../../packages/sdk/src/host.ts#L4825-L4845) - the `initialize` `_meta` block"
  - "[code://packages/sdk/src/host.ts#L6080-L6260](../../../../packages/sdk/src/host.ts#L6080-L6260) - the `vscode/*` methods already served, as the shape to copy"
  - "[code://packages/sdk/src/host.ts#L139-L240](../../../../packages/sdk/src/host.ts#L139-L240) - `NEEDS`, `UNGATED` and `GATE`"
  - "[code://packages/sdk/src/types/host.ts#L180-L195](../../../../packages/sdk/src/types/host.ts#L180-L195) - `HostOptions.computers`, the port beside this one"
  - "[code://test/users-gate.test.ts#L100-L130](../../../../test/users-gate.test.ts#L100-L130) - the staleness test"
---

## Objective

A host with a `containers` port serves the reference client's four dev container methods and four notifications, advertises `_meta['vscode.devContainers']`, and gates the three acting methods on `container:write`, with every connection's containers kept on that connection.

## Files

- `CREATE: packages/sdk/src/types/containers.ts` - `ContainerPort` and its shapes: `available()`, `connect({ connectionId, workspaceFolder, name })` answering `{ address, remoteWorkspaceFolder, hostWorkspaceFolder? }` plus a `ContainerChannel` of `write`, `onMessage`, `onClose` and `dispose`, and `disconnect(connectionId)`.
- `UPDATE: packages/sdk/src/types/host.ts` - `HostOptions.containers?: ContainerPort`.
- `UPDATE: packages/sdk/src/types/plugin.ts` - `registerContainers(port, when?)`, beside `registerComputers`.
- `UPDATE: packages/sdk/src/plugins.ts` - the registration, the duplicate check and the singleton rule.
- `UPDATE: packages/sdk/src/types/index.ts`, `packages/sdk/src/index.ts` - what is published.
- `UPDATE: packages/sdk/src/host.ts` - the four handlers, the four notifications, the `_meta` key, the `NEEDS`/`UNGATED` entries, and the per-connection map.
- `CREATE: test/containers.test.ts` - the surface's cases against a fake port.

## Steps

1. Declare the port where the other ports are declared, with the contract in prose: a port answers a channel for a workspace folder and does not know what a frame means. The SDK does the framing and the notifications, because framing is protocol knowledge.
2. Register it through `registerContainers` with the same singleton rule `registerComputers` has: one port, a second refused with a sentence.
3. Advertise `'vscode.devContainers': true` in the `initialize` `_meta` block only when the host holds a port, so a host without one is a host where the client never offers the flow.
4. Add the handlers to the per-connection `handlers` table: `isDockerAvailable` answers the port's availability boolean; `connect` validates the three params, refuses a `connectionId` already in use, asks the port and answers the result with the client's own `connectionId`; `disconnect` releases it; `relaySend` writes one frame to the channel and refuses `-32008` for a connection this client does not own.
5. Emit the four notifications through the connection's own peer: `relayMessage` for a frame, `output` for the port's stderr, `relayClose` when the channel closes and `closeConnection` after it. Both close notifications carry the client's `connectionId`, never the port's own id.
6. Classify the four methods: `container:write` for `connect`, `disconnect` and `relaySend`; `isDockerAvailable` in `UNGATED` with the sentence that says why a boolean starts nothing.
7. Keep the map in `accept`'s closure and dispose it where the connection's own timers are cleared, so a socket that drops takes its relays with it and a second client cannot name the first's.

## Validation

- `test/containers.test.ts` - the key is absent without a port and present with one; a granted client gets the port's answer and an ungranted one is refused `-32009` naming `container:write`; two clients' `connectionId`s do not collide and one cannot send on the other's; a channel that closes draws `relayClose` then `closeConnection` and the map forgets it.
- `test/users-gate.test.ts` - the staleness test passes with the four names classified.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

Done, 2026-09-24. See [implemented.md](implemented.md).
The port is a stream and the surface is a postbox: nothing in the SDK spawns a process or parses a frame's meaning.
