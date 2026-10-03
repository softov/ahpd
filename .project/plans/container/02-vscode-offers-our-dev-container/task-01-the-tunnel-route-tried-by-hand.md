---
title: The tunnel route tried by hand, with every check recorded
status: todo
depends: []
layer: "manual"
refs:
  - "[code://packages/tunnel-devtunnel/README.md](../../../../packages/tunnel-devtunnel/README.md) - how the daemon is put behind a Dev Tunnel and how VS Code connects to it"
  - "[code://packages/sdk/src/host.ts#L7430](../../../../packages/sdk/src/host.ts#L7430) - `containersReady`, which decides whether the capability is advertised"
  - "[code://.project/research/how-vscode-offers-a-dev-container.md](../../../research/how-vscode-offers-a-dev-container.md) - the six checks, in order"
---

## Objective

It is known, from a real VS Code 1.140 on Windows connected to ahpd through a Dev Tunnel, which of the six checks pass and where the flow stops.

## Files

- `UPDATE: .project/plans/container/02-vscode-offers-our-dev-container/task-01-the-tunnel-route-tried-by-hand.md` - the result, in *Resume*.

## Steps

1. On the Linux host: `devtunnel user login` with the same provider (GitHub or Microsoft) and the same account VS Code is signed in with, then the daemon with `@ahpd/tunnel-devtunnel` beside the launcher and `@ahpd/computer`, and `ahpd status` showing the tunnel.
2. Confirm `initialize` answers `_meta['vscode.devContainers']: true`: the `devcontainer` CLI and Docker both answer on the host.
3. In VS Code: check `chat.remoteAgentHostsEnabled` and `chat.agentHost.devContainer.enabled` were not turned off (both default to `true` in 1.140), then "Agents: Connect to Remote Agent Host via Dev Tunnel".
4. In New, pick a folder on that host with a `devcontainer.json` (the `.scratch/devc-work` fixture), and look for "Use Dev Container" in the workspace picker.
5. If it shows: pick it, send, and watch "Starting Dev Container..." to a running session. If it does not: VS Code's Agent Host output log, and the daemon log for `vscode/devContainers/isDockerAvailable`.
6. Record in *Resume* each check as passed or failed, with the log line that shows it.

## Validation

- The *Resume* section names every check and its result, and task 02's scope is written from it.

## Resume

2026-09-26: the daemon started with `@ahpd/tunnel-devtunnel` after the port-conflict fix, and Softov signed in to Dev Tunnels, but the tunnel did not appear in VS Code's Agents window.
Parked at Softov's request; checks 3 to 6 are untried.
Next: compare the tunnel's labels (`devtunnel show`) with what VS Code's `TunnelTags` and `TUNNEL_MIN_PROTOCOL_VERSION = 5` accept, and read VS Code's Agent Host log for the tunnel listing.

2026-10-02: the labels were compared and already match: `vscode-server-launcher`, the protocol label and `_ahpd` ([`code://packages/tunnel-devtunnel/src/discovery.ts#L69`](../../../../packages/tunnel-devtunnel/src/discovery.ts#L69)).
VS Code lists tunnels with its own GitHub or Microsoft token, so the likelier cause is a tunnel made under another provider or account; the next try starts with step 1's same provider and account.
