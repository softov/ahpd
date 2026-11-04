---
title: Check that the Dev Tunnel plugin shows its state
plans:
  - plans/plugin/20261031-1200-a-plugin-shows-its-state/plan.md
---

# Check that the Dev Tunnel plugin shows its state

plugin/20261031-1200 is on main (#175). The Dev Tunnel plugin's row carries `views.main` with the tunnel's state. Since 184ca4c8 the plugin runs on the Dev Tunnels SDK, with no `devtunnel` CLI. The tunnel checks of plugin/20261102-1122 passed on 2026-11-04.

## Set up

Stop your daemon with Ctrl+C in its terminal, then run this in that terminal:

```bash
cd /github/ahpd && git pull --ff-only && pnpm install --frozen-lockfile
node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --config-file /home/softov/.config/ahpd/config-dev.json
```

In a second terminal:

```bash
export AHPD_URL=ws://127.0.0.1:37537 AHPD_TOKEN_FILE=/home/softov/.vscode/cli/agent-host-token
rpc() { node /github/ahpd/.project/pending/rpc.mjs "$@"; }
```

## Steps

1. Read the plugin rows. Check that `views.main` of `tunnel-devtunnel` shows the address, tunnel id, port, relay state and client count:

```bash
rpc subscribe '{"channel":"x-ahpd-plugins://"}' | grep -o '"views":.\{0,600\}'
```

2. Connect a client through the tunnel, wait 30 seconds, and read the rows again. Check that the client count went up.
3. Disable the tunnel in ahpw, and read the rows again. Check that `views.main` is gone.
4. Enable the tunnel, turn off the network for one minute, and read the rows again. Check that the last view stayed.

## Reply

Write "pass", or say which step stopped.
