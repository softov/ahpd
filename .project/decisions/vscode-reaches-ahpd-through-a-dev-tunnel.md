---
title: VS Code reaches ahpd through a Dev Tunnel for its dev container flow
status: accepted
date: 2026-09-26
refs:
  - "[code://.project/research/how-vscode-offers-a-dev-container.md](../research/how-vscode-offers-a-dev-container.md) - the checks VS Code makes and the entry types that pass them"
  - "[code://packages/tunnel-devtunnel/README.md](../../packages/tunnel-devtunnel/README.md) - the plugin that already forwards the daemon through a Dev Tunnel"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/sessions/contrib/providers/remoteAgentHost/browser/devContainerSource.ts#L26-L33 - only SSH, Tunnel and WSL entries are a dev container source
---

## Context

VS Code offers "Use Dev Container" on a remote folder only when the host's entry is SSH, Tunnel or WSL.
ahpd is added by URL, which makes it a WebSocket entry, so the flow `container/01` built is never offered from VS Code.
Softov's VS Code runs on Windows without Docker, and the daemon and its Docker are on a Linux box.

## Decision

The route is a Dev Tunnel: the daemon runs with `@ahpd/tunnel-devtunnel`, and VS Code connects with "Agents: Connect to Remote Agent Host via Dev Tunnel".
Source: Softov, 2026-09-26, asked "Which route should carry ahpd into VS Code so it offers \"Use Dev Container\"?", answered "Tunnel".

## Consequences

The plugin exists, so the route is tried before any code is written, and what ahpd changes is only what that try finds missing.
Both ends sign in to Dev Tunnels, and every frame crosses Microsoft's relay.
An SSH route stays an idea: [an SSH command that attaches to the daemon](../ideas/an-ssh-command-that-attaches-to-the-daemon.md).

## Options

- **SSH with `chat.sshRemoteAgentHostCommand`.** No third party in the path, but the setting is a per-window dev override, and ahpd would need an `ahpd attach` command to print the running daemon's URL.
- **SSH through VS Code's endpoint registry.** A plain SSH entry would find ahpd, but ahpd would write a file layout VS Code shares with its Rust CLI and versions on its own.
- **Docker on Windows.** Works for a local folder today, and never reaches ahpd.
