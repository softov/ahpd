---
title: Check the host's tunnels
plans:
  - plans/plugin/20261102-1122-the-host-keeps-the-tunnels/plan.md
---

# Check the host's tunnels

Plan plugin 1122 moves devtunnel from the CLI to the Dev Tunnels SDK, and the host keeps the tunnels at `x-ahpd-tunnels://`. Its tests use a fake Dev Tunnels service. This check needs your daemon, a signed-in `devtunnel` connector and the network.
Sign in the connector first, as [plugin-1054-device-sign-in-checks.md](plugin-1054-device-sign-in-checks.md) says, and set it as the devtunnel option `connector`.
Restart the daemon on main before you start.

## Steps

1. Check that `x-ahpd-tunnels://` lists the system tunnel with `purpose: system`, a URL and `status: running`.
2. Check that VS Code reaches the daemon through the system tunnel with the token it had before the upgrade.
3. Check the same for ahpc.
4. Run `x-ahpd/invokeOperation` with `devtunnel/create` on a local port. Check that its URL answers.
5. Run `disable` on that tunnel. Check that it stops and stays on the list.
6. Run `enable`, then restart the daemon. Check that the tunnel runs again.
7. Check that no `devtunnel` process runs.

## Reply

Write "done" when each step works, or say which step stopped.
