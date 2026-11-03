---
title: Check the dev container route in VS Code on Windows
plans:
  - plans/container/02-vscode-offers-our-dev-container/plan.md
---

# Check the dev container route in VS Code on Windows

container/02 waits on this run. VS Code on Windows connects to your daemon through a Dev Tunnel, and makes a dev container on this Linux host. The last try, on 2026-09-26, stopped because the tunnel did not show in VS Code. Since 184ca4c8 the tunnel runs on the Dev Tunnels SDK and signs in with a `devtunnel` connector, not the `devtunnel` CLI.

## Set up

1. Do [plugin-1054-device-sign-in-checks.md](plugin-1054-device-sign-in-checks.md) and [plugin-1122-tunnel-checks.md](plugin-1122-tunnel-checks.md) first. Sign in with the GitHub account that VS Code on Windows uses.
2. On this host, check the tools. `devcontainer` and `docker` are installed here:

```bash
devcontainer --version && docker ps
```

3. In VS Code on Windows, turn on `chat.remoteAgentHostsEnabled` and `chat.agentHost.devContainer.enabled`.

## The tunnel shows in VS Code

1. Run "Agents: Connect to Remote Agent Host via Dev Tunnel".
2. Check that the ahpd tunnel is in the list, and connect to it.

## The folder offers "Use Dev Container"

1. In New, pick `/github/ahpapp/.scratch/devc-work` on the Linux host. It has a `devcontainer.json`.
2. Check that the workspace picker shows "Use Dev Container".

## The first send makes the container

1. Pick "Use Dev Container", type a prompt, and send it.
2. Check that VS Code shows "Starting Dev Container...", and then a running session.
3. On the Linux host, check that `docker ps` shows the container.

## The session survives a reload

1. Reload the VS Code window.
2. Check that the session is still there, and that it answers one more turn.

## Stop and remove act on the Linux host

1. Stop the idle dev container from VS Code, and check on the Linux host that `docker ps` no longer shows it.
2. Remove it from VS Code, and check that `docker ps -a` no longer shows it.

## If a step fails

1. Copy VS Code's Agent Host output log.
2. Copy the lines with `vscode/devContainers/isDockerAvailable` from the daemon's terminal.
3. Add both to your reply.

## Reply

Write "pass" for each section, or what you saw.
