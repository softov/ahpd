---
title: The dev container surface is the reference client's own, name for name
status: accepted
date: 2026-09-24
refs:
  - "[code://packages/sdk/src/host.ts#L4735-L4760](../../packages/sdk/src/host.ts#L4735-L4760) - the per-connection `handlers`, which is where these methods go"
  - "[code://packages/sdk/src/host.ts#L6080-L6260](../../packages/sdk/src/host.ts#L6080-L6260) - the `vscode/*` extension methods this host already serves"
  - "[code://packages/sdk/src/host.ts#L4825-L4845](../../packages/sdk/src/host.ts#L4825-L4845) - `initialize` and the `_meta` block the key joins"
  - "[code://packages/sdk/src/types/host.ts#L458-L500](../../packages/sdk/src/types/host.ts#L458-L500) - `Connection`, which is per socket and owns what a socket owns"
  - "[code://.project/ideas/dev-container-sessions.md](../ideas/dev-container-sessions.md) - the relay surface as the reference client uses it"
  - "[code://.project/research/a-backend-inside-a-machine.md](../research/a-backend-inside-a-machine.md) - why the nested host is the route that covers every backend"
---

## Context

The reference host serves a dev container surface of its own: four methods (`vscode/devContainers/isDockerAvailable`, `connect`, `disconnect`, `relaySend`) and four notifications (`relayMessage`, `relayClose`, `closeConnection`, `output`), all gated on `_meta['vscode.devContainers'] === true` (`agentHostExtensionProtocol.ts:16-23`, `agentHostDevContainersMeta.ts:8-13`).
The client reads that key before it offers anything and calls exactly those names (`devContainerAgentHostConnector.contribution.ts:305` and `:324`).

This host already serves several of VS Code's own extension methods and advertises their keys: the detached worktree five, `vscode/removeSessionArtifact`, `vscode/getAgentHostSessionStateFile`, `vscode/collectAgentHostDebugLogs`.
The protocol's `_meta` is the implementation-defined escape hatch and its rule is that a client ignores a key it does not know, so a vendor surface here is established practice rather than an invention, and it is the same practice `ahpd.resourceProviders` follows in the other direction.

## Decision

This host serves the reference's dev container surface exactly: the same four method names, the same four notification names, the same parameter and result fields, and the same capability key.

- `connect({ connectionId, workspaceFolder, name })` answers `{ connectionId, address, name, remoteWorkspaceFolder, hostWorkspaceFolder? }`, with `address` spelled `devcontainer:<containerId>`.
- `relaySend({ connectionId, data })` carries one frame as a string, and `relayMessage` carries one back, which is what the reference's `IRelayMessage` is.
- `connectionId` is the client's own name for the connection and is namespaced per connection here: the map lives in `accept`'s closure, so one client's ids cannot name another's relay, and the relay dies with the socket.
- There is no `ahpd/containers/*` dialect. Our own client drives these four methods through its own transport, the way `ahpapp` already drives the `vscode`-named worktree methods it needs.

## Consequences

VS Code's dev container flow works against this host with no client work, which is the whole reason to serve another program's names.
`ahpapp` gets the feature by implementing a transport over `relaySend` and `relayMessage` and adding the nested host as a connection it holds, not by a second surface.
A client that does not know the key ignores it, so nothing about the surface is forced on anyone.
The names are another program's and will not move when AHP grows a typed field for any of this. That debt is recorded here rather than avoided, and the key is what would let both exist at once: a typed field later, the key retired after a release or two.
The state is per connection, not per host, which is where a container belongs: a relay is one client's, and a socket that drops takes its containers with it.

## Options

- **Our own `ahpd/containers/*` names.** Rejected: a second dialect for one feature, and the client that already has the flow is the one that would not understand it.
- **Wait for a typed AHP method upstream.** Rejected for now: the protocol's types are closed on both sides and the reference client only reads the key, so a typed field would be built before anything could use it.
- **Serve both names for a transition.** Rejected: two names for one act is two places to fix a bug, and no client needs the second.
- **Put the relay map on the host rather than the connection.** Rejected: a container started for one client would be reachable by another, and the reference's own namespacing exists because that was a real bug class.
