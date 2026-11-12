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
- One PowerShell window, kept open to the end.

Your own daemon is not touched. The test daemon uses only `C:\ahpd-check` and `C:\ahpd-check-home`, and listens on port 39200.

## 1. Get main and build it

```powershell
git clone https://github.com/ahpio/ahpd.git C:\ahpd-check
cd C:\ahpd-check
pnpm install --frozen-lockfile
pnpm build
npm install -g @softov/ahpc
```

If `C:\ahpd-check` is already there from an earlier check, run `git -C C:\ahpd-check pull` in place of the clone.

## 2. Make the folder the session works in

```powershell
mkdir C:\work\demo
git -C C:\work\demo init
copy C:\ahpd-check\packages\agent-acp\test\fixtures\acp-server.mjs C:\work\demo\
```

The copy puts the test agent in the folder. The agent runs inside the machine, which sees `C:\work\demo` as `/c/work/demo`, so the agent must be in that folder.

## 3. Create the test daemon's three files

Make the folder `C:\ahpd-check-home\config\ahpd\agents`. Then create these three files in Notepad, and save each one with the name and content shown.

`C:\ahpd-check-home\token`:

```text
check-token
```

`C:\ahpd-check-home\config\ahpd\config.json`:

```json
{
  "paths": ["C:/work/demo"],
  "plugins": [
    "C:/ahpd-check/packages/agent-acp",
    { "name": "C:/ahpd-check/packages/computer", "options": { "profiles": {
      "scratch": { "title": "Scratch", "image": "node:22", "disposable": true, "sessionFolder": true }
    } } }
  ]
}
```

`C:\ahpd-check-home\config\ahpd\agents\acp-check.json`:

```json
{ "id": "acp-check", "engine": "acp", "owner": "host", "name": "ACP check",
  "config": { "command": "node", "args": ["/c/work/demo/acp-server.mjs"] } }
```

- `config.json` loads two plugins. `scratch` is a machine profile: `disposable` makes a new machine for the session, and `sessionFolder` mounts `C:\work\demo` in it at `/c/work/demo`.
- `acp-check.json` is the agent. Its command runs inside the machine, so it names the machine's path.

## 4. Start the test daemon

Point this window at the test daemon's folders, then start it:

```powershell
$env:XDG_CONFIG_HOME = "C:\ahpd-check-home\config"
$env:XDG_STATE_HOME = "C:\ahpd-check-home\state"
$env:XDG_DATA_HOME = "C:\ahpd-check-home\data"
node C:\ahpd-check\packages\server\dist\main.js start --port 39200 --connection-token-file C:\ahpd-check-home\token
```

Check that it answers:

```powershell
ahpc --host ws://127.0.0.1:39200 --connection-token-file C:\ahpd-check-home\token session list
```

It answers with an empty list. If it cannot connect, read `C:\ahpd-check-home\config\ahpd\daemon.log`.

## 5. Open a session in a new machine

```powershell
ahpc --host ws://127.0.0.1:39200 --connection-token-file C:\ahpd-check-home\token session new --agent acp-check --cwd C:\work\demo --trust --set computer=disposable:scratch --json
```

- The answer is `{ "resource": "acp-check:/..." }`. Copy that value: the next steps call it `<resource>`.
- The first run can take a few minutes, because Docker pulls `node:22`.
- `docker ps` now shows one container whose name starts with `ahpd-computer`.

If the answer says a part could not be loaded, run this in `C:\ahpd-check`, then run step 5 again:

```powershell
node --conditions development --import ./scripts/dev.mjs scripts/parts-publish.mjs --local
```

## 6. Run the turn

```powershell
ahpc --host ws://127.0.0.1:39200 --connection-token-file C:\ahpd-check-home\token prompt <resource> "paint"
type C:\work\demo\painted.txt
git -C C:\work\demo status --short
```

## What a pass looks like

| What | Pass | Fail |
| --- | --- | --- |
| The `prompt` output | A tool call named *Paint and preview* that completes, and the turn ends with no error | `error code: 267`, or the turn ends in an error |
| `type` | `a line of paint` | The file is not there |
| `git status --short` | `?? acp-server.mjs` and `?? painted.txt`, and nothing else | Other files, or ` M` on a file you did not change |

## 7. Clean up

```powershell
ahpc --host ws://127.0.0.1:39200 --connection-token-file C:\ahpd-check-home\token session rm <resource>
node C:\ahpd-check\packages\server\dist\main.js stop
del C:\work\demo\painted.txt, C:\work\demo\acp-server.mjs
```

The machine is removed five minutes after its session goes. Close the PowerShell window to drop the three `XDG_*` variables.

## Reply

Write "pass", or the step that failed and its output.
For a fail, also send the output of `ahpc --host ws://127.0.0.1:39200 --connection-token-file C:\ahpd-check-home\token session history <resource> --full`, and the end of `C:\ahpd-check-home\config\ahpd\daemon.log`.
