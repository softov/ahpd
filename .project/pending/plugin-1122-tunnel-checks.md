---
title: Check the host's tunnels
plans:
  - plans/plugin/20261102-1122-the-host-keeps-the-tunnels/plan.md
---

# Check the host's tunnels

plugin/20261102-1122 is on main. devtunnel runs on the Dev Tunnels SDK, with no `devtunnel` CLI, and the host keeps the tunnels at `x-ahpd-tunnels://`. The `devtunnel` connector is signed in: its check passed on 2026-11-04.

## Set up

1. Name the signed-in connector in the devtunnel plugin's options in `config-dev.json`. Its id is `devtunnel`, the file `~/.config/ahpd/connectors/devtunnel.json`:

```bash
node -e 'const fs=require("fs"),f="/home/softov/.config/ahpd/config-dev.json",c=JSON.parse(fs.readFileSync(f,"utf8"));const p=c.plugins.find((one)=>String(one.source??one.name).includes("tunnel-devtunnel"));p.options={...p.options,connector:process.argv[1]};fs.writeFileSync(f,JSON.stringify(c,null,2)+"\n")' devtunnel
```

2. Stop your daemon with Ctrl+C in its terminal, then run this in that terminal:

```bash
cd /github/ahpd && git pull --ff-only && pnpm install --frozen-lockfile
node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --config-file /home/softov/.config/ahpd/config-dev.json
```

3. In a second terminal:

```bash
export AHPD_URL=ws://127.0.0.1:37537 AHPD_TOKEN_FILE=/home/softov/.vscode/cli/agent-host-token
rpc() { node /github/ahpd/.project/pending/rpc.mjs "$@"; }
```

## Steps

1. List the tunnels, and check that the system tunnel has `purpose: system`, a URL and `status: running`:

```bash
rpc subscribe '{"channel":"x-ahpd-tunnels://"}'
```

2. Check that VS Code reaches the daemon through the system tunnel with the token it had before.
3. Check the same with ahpc.
4. Make a tunnel on a local port, such as 8000, and check that its URL answers:

```bash
rpc x-ahpd/invokeOperation '{"channel":"x-ahpd-tunnels://","operationId":"devtunnel/create","input":{"connector":"<id>","port":8000}}'
```

5. Disable that tunnel in ahpw. Check that it stops and stays on the list.
6. Enable it, then restart the daemon. Check that the tunnel runs again.
7. Run `pgrep -fa devtunnel`, and check that it shows no process.

## Reply

Write "pass", or say which step stopped.
