---
title: Check a terminal turn in a Windows machine
plans:
  - plans/acp/19-a-terminal-in-a-machine-runs-in-the-machine/plan.md
---

# Check a terminal turn in a Windows machine

An ACP agent in a Docker machine asks the host for a terminal. Since acp/19 (#51), that terminal runs in the machine, not on Windows.
On 2026-10-20 it ran on Windows and the turn failed with `error code: 267`, as daemon/33-p7's [implemented.md](../plans/daemon/33-p7-a-windows-folder-has-a-path-in-the-machine/implemented.md) says.
This check runs that turn again. It takes about 30 minutes.

## What you need

- The Windows 10 VM, with Docker Desktop running on WSL 2.
- Node 22, pnpm, and Git for Windows. Run `node -v`, `pnpm -v` and `git --version` to see them. If pnpm is missing, run `corepack enable`.
- One PowerShell window. Every command below runs in it, in order. Do not close it until the end: the commands use variables it sets.

Your own daemon is not touched. The test daemon has its own folders under `$HOME\ahpd-check-home` and listens on port 39200.

## 1. Get main and build it

```powershell
git clone https://github.com/ahpio/ahpd.git $HOME\ahpd-check
cd $HOME\ahpd-check
pnpm install --frozen-lockfile
pnpm build
npm install -g @softov/ahpc
```

If `$HOME\ahpd-check` is already there from an earlier check, run `git -C $HOME\ahpd-check pull` and the last three lines instead of the clone.

## 2. Make the folder the session works in

```powershell
New-Item -ItemType Directory -Force C:\work\demo | Out-Null
git -C C:\work\demo init
Copy-Item $HOME\ahpd-check\packages\agent-acp\test\fixtures\acp-server.mjs C:\work\demo\
```

The last line copies the test agent into the folder. The agent runs inside the machine, and the machine sees `C:\work\demo` as `/c/work/demo`, so the agent must be in that folder.

## 3. Give the test daemon its own folders and config

```powershell
$h = "$HOME\ahpd-check-home"
$env:XDG_CONFIG_HOME = "$h\config"
$env:XDG_STATE_HOME = "$h\state"
$env:XDG_DATA_HOME = "$h\data"
New-Item -ItemType Directory -Force "$h\config\ahpd\agents" | Out-Null
Set-Content "$h\token" "check-token"
$clone = "$HOME\ahpd-check" -replace '\\', '/'
@"
{
  "paths": ["C:/work/demo"],
  "plugins": [
    "$clone/packages/agent-acp",
    { "name": "$clone/packages/computer", "options": { "profiles": {
      "scratch": { "title": "Scratch", "image": "node:22", "disposable": true, "sessionFolder": true }
    } } }
  ]
}
"@ | Set-Content "$h\config\ahpd\config.json"
@'
{ "id": "acp-check", "engine": "acp", "owner": "host", "name": "ACP check",
  "config": { "command": "node", "args": ["/c/work/demo/acp-server.mjs"] } }
'@ | Set-Content "$h\config\ahpd\agents\acp-check.json"
```

- `scratch` is a machine profile. `disposable` makes a new machine for the session, and `sessionFolder` mounts `C:\work\demo` in it at `/c/work/demo`.
- `acp-check` is the agent. Its command runs inside the machine, so its path is the machine's path.

## 4. Start the test daemon

```powershell
node $HOME\ahpd-check\packages\server\dist\main.js start --port 39200 --connection-token-file "$h\token"
function ahpcc { ahpc --host ws://127.0.0.1:39200 --connection-token-file "$h\token" --no-update-check @args }
ahpcc session list
```

The last line answers with an empty list. If it answers that it cannot connect, read `$h\config\ahpd\daemon.log`.

## 5. Open a session in a new machine

```powershell
ahpcc session new --agent acp-check --cwd C:\work\demo --trust --set computer=disposable:scratch --json
```

- The answer is JSON with a `resource` field, such as `acp-check:/5d0c...`. Copy that value.
- The first run can take a few minutes, because Docker pulls `node:22`.
- `docker ps` now shows one container whose name starts with `ahpd-computer`.

If the answer says a part could not be loaded, run this line in `$HOME\ahpd-check`, then run step 5 again:

```powershell
node --conditions development --import ./scripts/dev.mjs scripts/parts-publish.mjs --local
```

## 6. Run the turn

Put the `resource` value from step 5 in place of `<resource>`:

```powershell
ahpcc prompt <resource> "paint"
Get-Content C:\work\demo\painted.txt
git -C C:\work\demo status --short
```

## What a pass looks like

| What | Pass | Fail |
| --- | --- | --- |
| The `prompt` output | A tool call named *Paint and preview* that completes, and the turn ends with no error | `error code: 267`, or the turn ends in an error |
| `Get-Content` | `a line of paint` | The file is not there |
| `git status --short` | `?? acp-server.mjs` and `?? painted.txt`, and nothing else | Other files, or ` M` on a file you did not change |

## 7. Clean up

```powershell
ahpcc session rm <resource>
node $HOME\ahpd-check\packages\server\dist\main.js stop
Remove-Item C:\work\demo\painted.txt, C:\work\demo\acp-server.mjs
```

The machine is removed five minutes after its session goes.
Close the PowerShell window to drop the `XDG_*` variables.

## Reply

Write "pass", or the step that failed and its output.
For a fail, also send `ahpcc session history <resource> --full`, and the last 50 lines of `$h\config\ahpd\daemon.log`.
