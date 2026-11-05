---
title: Check a terminal turn in a Windows machine
plans:
  - plans/acp/19-a-terminal-in-a-machine-runs-in-the-machine/plan.md
---

# Check a terminal turn in a Windows machine

acp/19 is on main (#51). An ACP agent's `terminal/create` in a machine session runs in the machine. On 2026-10-20 that turn failed on Windows with `error code: 267`, because the terminal ran on the host. The results of that run are in daemon/33-p7's [implemented.md](../plans/daemon/33-p7-a-windows-folder-has-a-path-in-the-machine/implemented.md).

## Set up

On the Windows 10 VM with Docker Desktop, in PowerShell:

```powershell
git clone git@github.com:softov/ahpd.git $HOME\ahpd-check; cd $HOME\ahpd-check; pnpm install; pnpm build
mkdir C:\work\demo; git -C C:\work\demo init
```

Use the profile and the agent of the 2026-10-20 run: a `node:22` profile with `sessionFolder`, and an agent record with `"engine": "acp"` whose command is `node <clone>\packages\agent-acp\test\fixtures\acp-server.mjs`. A record from that run names no engine, and the daemon now lists such a record as unavailable.

## The paint turn

1. Start the daemon with `node packages\server\dist\main.js start`.
2. With ahpc, open a session in `C:\work\demo`, in a disposable machine of that profile.
3. Send the turn `paint`.
4. Check that the turn ends complete, and that `C:\work\demo\painted.txt` is on Windows.

## Reply

Write "pass", or what you saw.
