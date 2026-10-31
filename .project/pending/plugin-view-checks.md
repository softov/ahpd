---
title: Check that the Dev Tunnel plugin shows its state
plans:
  - plans/plugin/20261031-1200-a-plugin-shows-its-state/plan.md
---

# Check that the Dev Tunnel plugin shows its state

The plan `plugin/20261031-1200-a-plugin-shows-its-state` merged in #175, and its tests pass. The `show` fixtures come from the field names, not from a captured answer. These checks need a machine with the `devtunnel` CLI, signed in.

## Set up

1. Start a test ahpd from main with the Dev Tunnel plugin, with `XDG_CONFIG_HOME` and `XDG_DATA_HOME` set to scratch folders.
2. Keep a client open that reads the `x-ahpd-plugins` channel.

## Steps

1. Run `devtunnel show <id> --json` on the plugin's tunnel, and keep the output for the fixtures.
2. Read `views.main` on the plugin's row. Expect the address, tunnel id, port, relay state and client count.
3. Connect a client through the tunnel, and wait 30 seconds. Expect the client count to go up.
4. Stop the tunnel. Expect `views.main` to be gone from the row.
5. Start the tunnel, and cut the network for one poll. Expect the last view to stay.

## Reply

- Write "ok", or what went wrong at which step, and attach the `show` output of step 1.
