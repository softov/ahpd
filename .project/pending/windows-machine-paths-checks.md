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
- Scripts allowed in that window. Windows 10 blocks `pnpm.ps1` and `ahpc.ps1` by default, so run `Set-ExecutionPolicy -Scope Process Bypass` first.

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

The daemon removes a disposable machine five minutes after its session goes, and the `stop` above comes first.
So run `docker ps -a` and remove each `ahpd-computer-*` container left with `docker rm -f <name>`, and its `ahpd-git-<name>` volume with `docker volume rm`.
Close the PowerShell window to drop the `XDG_*` variables.

## Results on Windows, 2026-11-12

Run by Claude over ssh on the Windows 10 VM, from ahpd `main` at `b4ad32951` and ahpc 0.10.0.
The VM has Docker Desktop 29.9.1 on WSL 2 and Node 22.23.3.
The check is not passed: the terminal now runs in the machine, and two steps need the plans in the table.

- **Steps 1 to 4:** pass.
- **Step 5:** fail. `Request "createSession" timed out after 30000ms`, because making the machine took about 38 s.
  It passed with the ahpc limit raised by hand on the VM.
- **Step 6, the terminal:** pass. Docker's events show `exec_create: echo hello from the shell` in the session's machine, and no `error code: 267`.
  The window title in the output, `Administrator: ...powershell.exe`, is the parent console's title, not where the command ran.
- **Step 6, the turn:** pass after a manual answer. The turn stopped on a permission, *Remove a file*, until `ahpc confirm` answered it.
  *Paint and preview* completed, and `painted.txt` holds `a line of paint`.
- **Step 6, `git status`:** fail. `hello.txt` and `written.txt` are there too.
- **Step 7:** the machine and six `ahpd-git-*` volumes stayed after `stop`.

The table names the plan for each finding.

| Finding | Plan |
| --- | --- |
| ahpc stops waiting for `createSession` after 30 s | [host/20261112-0821-making-a-session-reports-progress](../plans/host/20261112-0821-making-a-session-reports-progress/plan.md), then ahpc's `cli/20261112-0821-create-session-waits-on-progress` |
| The git seed makes about nine `docker exec` calls, one at a time | [container/20261112-0821-a-git-seed-takes-three-execs](../plans/container/20261112-0821-a-git-seed-takes-three-execs/plan.md) |
| A new session with no message is never removed, with its machine | [host/20261112-0821-an-unused-new-session-is-removed](../plans/host/20261112-0821-an-unused-new-session-is-removed/plan.md) |
| A failed machine create leaves its container and git volume | [container/20261112-0821-a-failed-machine-leaves-nothing](../plans/container/20261112-0821-a-failed-machine-leaves-nothing/plan.md) |
| `session/list` runs the agent's machine command on Windows at each connect | [acp/20261112-0821-sessions-are-listed-in-their-machines](../plans/acp/20261112-0821-sessions-are-listed-in-their-machines/plan.md) |
| Session remove runs `rm -rf` of a host attachments path in the machine | [container/20261112-0821-only-copied-attachments-are-removed](../plans/container/20261112-0821-only-copied-attachments-are-removed/plan.md) |
| Host tools are left out, with the daemon on 127.0.0.1 | [container/20261112-0821-a-machine-says-how-it-reaches-the-host](../plans/container/20261112-0821-a-machine-says-how-it-reaches-the-host/plan.md) |
| The host's instructions start the test agent's `term`, `ask` and `write` | [acp/20261112-0821-the-test-agent-reads-what-was-said](../plans/acp/20261112-0821-the-test-agent-reads-what-was-said/plan.md) |

Docker Desktop failed at its first start with `WSL update required`, and started after a restart. That is the VM, not ahpd.

## Reply

Write "pass", or the step that failed and its output.
For a fail, also send `ahpcc session history <resource> --full`, and the last 50 lines of `$h\config\ahpd\daemon.log`.
