---
title: Check a Dev Tunnel plugin that fails on a real daemon
plans:
  - plans/plugin/20261101-1803-a-plugin-that-fails-says-so/plan.md
---

# Check a Dev Tunnel plugin that fails on a real daemon

plugin/20261101-1803 is built and its tests pass.
This run uses a test daemon with the Dev Tunnel plugin, a signed-in `devtunnel` CLI and ahpw.
It is the plan's final verification checklist.

## Set up

1. Build the branch `plugin/20261101-1803-a-plugin-that-fails-says-so`.
2. Start a test daemon from that build, isolated with its own `XDG_CONFIG_HOME`.
3. Enable the Dev Tunnel plugin with anonymous access on.
4. Open ahpw on the test daemon's plugins page.

## Anonymous access

1. Make sure that the daemon log shows no `access create` error.
2. Make sure that `devtunnel show <id>` lists anonymous access on port 31546.
3. Make sure that the Dev Tunnel row has no alert.

## Disable and enable

1. Disable the Dev Tunnel plugin in ahpw.
2. Make sure that no `devtunnel host` process runs.
3. Enable the plugin again.
4. Make sure that the tunnel comes back, and that one `devtunnel host` process runs.

## A tunnel that fails

1. Kill the `devtunnel host` process.
2. Make sure that the row shows the alert "The tunnel stopped unexpectedly, so disable and enable the plugin to start it again."
3. Make sure that ahpw's list shows the Dev Tunnel row as failing.
4. Disable and enable the plugin, and make sure that the alert goes.

## Reply

Write "pass" for each section, or what you saw.
