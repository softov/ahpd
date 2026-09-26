---
title: When VS Code offers "Use Dev Container", and why it never does for ahpd
date: 2026-09-26
refs:
  - "[code://packages/sdk/src/host.ts#L5140-L5149](../../packages/sdk/src/host.ts#L5140-L5149) - the `vscode.devContainers` key, advertised only when `containersReady`"
  - "[code://packages/sdk/src/host.ts#L5062](../../packages/sdk/src/host.ts#L5062) - `containersReady`: the launcher loaded, Docker and the Dev Container CLI present"
  - "[code://packages/tunnel-devtunnel/README.md](../../packages/tunnel-devtunnel/README.md) - the plugin that makes this host a Dev Tunnel VS Code can connect to"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/sessions/contrib/providers/remoteAgentHost/electron-browser/devContainerAgentHostConnector.contribution.ts#L126-L140 - `isDevContainerWorkspaceAvailable`, the two settings, the URI scheme, the config file and Docker
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/sessions/contrib/providers/remoteAgentHost/browser/devContainerSource.ts#L26-L33 - `getDevContainerSourceEntry`, which accepts only an SSH, Tunnel or WSL entry
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/sshRemoteAgentHostService.ts#L937-L953 - an SSH entry with `chat.sshRemoteAgentHostCommand` runs that command and skips the VS Code CLI
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/sshRemoteAgentHostHelpers.ts#L286-L291 - the command must print `ws://127.0.0.1:PORT[?tkn=TOKEN]`
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/sshRemoteAgentHostService.ts#L596-L599 - a TCP endpoint is reached by an SSH port forward, with no VS Code CLI on the far side
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/common/agentHostEndpointRegistry.ts - the endpoint registry an SSH entry reads through `code agent endpoints`
---

Softov picked a folder with a `.devcontainer/devcontainer.json`, with `chat.agentHost.devContainer.enabled` on, and VS Code 1.139.1 on Windows offered nothing.
This note is what VS Code checks, and which of those checks ahpd fails.

## What VS Code checks

The workspace picker offers "Use Dev Container" only when all of these hold:

1. `chat.agentHost.devContainer.enabled` is on (default off).
2. `chat.remoteAgentHostsEnabled` is on.
3. The folder is a local `file:` folder, or an `agent-host:` folder on a host whose entry is **SSH, Tunnel or WSL**.
4. The folder has `.devcontainer/devcontainer.json` or `.devcontainer.json`.
5. Docker answers: the local one for a `file:` folder, the host's `vscode/devContainers/isDockerAvailable` for a remote one.
6. For a remote folder, the host advertised `_meta['vscode.devContainers'] === true` in `initialize`.

The container is made at the first send, not when it is picked: the picker only marks the draft, and "Starting Dev Container..." runs inside `prepareNewSession`.

## Where ahpd fails them

- **Check 3.** ahpd is added by URL, which makes it a WebSocket entry, and `getDevContainerSourceEntry` leaves WebSocket entries out. A folder on ahpd is never a dev container source, however ahpd answers.
- **Check 5, for a local folder.** A `file:` folder on Windows is launched by VS Code itself, with Windows' Docker. Softov's Windows has none, so "Use Local" can never offer it there. That path does not touch ahpd at all.
- **Check 6** passes already when the Linux box has Docker and the `devcontainer` CLI; ahpd advertises the key then.

## The entry types that could carry ahpd

- **Tunnel.** `@ahpd/tunnel-devtunnel` already forwards the daemon's port through a Dev Tunnel labelled the way VS Code looks for, and "Agents: Connect to Remote Agent Host via Dev Tunnel" makes a Tunnel entry. Nothing in VS Code's dev container path depends on the host behind a tunnel being VS Code's own. This needs no ahpd change to try.
- **SSH, with `chat.sshRemoteAgentHostCommand`.** VS Code runs the command over SSH, scrapes the first `ws://127.0.0.1:PORT` it prints, and forwards that port over the SSH connection, with no VS Code CLI installed. The setting is one per window and marked a dev override, and VS Code treats the command as a process it owns: it expects to start it, not to find a daemon already running. A small `ahpd attach` that prints the running daemon's URL and stays open would fit it.
- **SSH, through the endpoint registry.** Without the override, VS Code installs its own CLI on the remote and lists live hosts with `code agent endpoints`. ahpd could write a `standalone` TCP entry into that registry and be picked from it. That couples ahpd to a file layout VS Code shares with its Rust CLI and versions itself.
- **WSL.** Only for a Linux inside the same Windows machine, which is not where Softov's daemon runs.

## What stays open after VS Code offers it

- The relay ties the dev container to the client connection that asked for it. After a reload, VS Code keeps its provider and its sessions and reconnects on demand; ahpapp does not yet.
- A container made this way is not a `computer://`. Softov chose on 2026-09-26 that a dev container is a kind of computer (option B), with the relay kept for parity, so the same container should also be listed and reachable without the connection that made it.
