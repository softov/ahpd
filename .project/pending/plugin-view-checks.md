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

Your daemon has users, so since #303 the system tunnel lets VS Code in only when the plugin's `person` option names a person. Without it, VS Code gets a 401, and the tunnel's row says to set `person`. Before step 1, set `person` to `user:` and your id in the `@ahpd/tunnel-devtunnel` entry of `config-dev.json`, as the plugin's README shows under *Options*.

If the view is not there, the system tunnel failed at start: see the problem `a-system-tunnel-that-fails-at-start-is-not-retried`. Disable and enable it in ahpw.

## Results so far

On 2026-11-04 Claude read the view after one disable and one enable of the system tunnel. It held the address, tunnel `swift-fog-zm4rwhl`, port 31546, the relay state and 0 clients. It went away while the tunnel was off, and came back after the enable.

## Steps

1. Connect VS Code through the system tunnel, wait 30 seconds, and read the rows again. Check that the client count went up. A plain WebSocket client held open through the tunnel for 70 seconds left the count at 0.

```bash
rpc subscribe '{"channel":"x-ahpd-plugins://"}' | grep -o '"clients-value".\{0,120\}'
```

2. Turn off the network for one minute, and read the rows again. Check that the last view stayed.

## Reply

Write "pass", or say which step stopped.
