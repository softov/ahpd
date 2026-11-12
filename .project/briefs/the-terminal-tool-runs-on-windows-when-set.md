---
title: The agent terminal tool runs on Windows when a setting says so
created: 2026-11-12
refs:
  - git://1f8ebac6f - the commit of ahpd the facts were checked at
  - "[code://packages/sdk/src/host/tooling.ts#L515-L526](../../packages/sdk/src/host/tooling.ts#L515-L526) - `shellToolsFor`: the tool is offered when `enableCustomTerminalTool` is true, the platform is not `win32`, and a terminal store exists"
  - "[code://packages/sdk/src/tools/shell.ts#L13-L15](../../packages/sdk/src/tools/shell.ts#L13-L15) - the tool's descriptions are VS Code's with the sandbox off: ahpd sandboxes the tool on no platform"
  - "[code://packages/sdk/src/tools/shell.ts#L272-L280](../../packages/sdk/src/tools/shell.ts#L272-L280) - the primary tool, `bash` or `powershell`, sets no `confirm`, so the backend's approval decides as for any tool"
  - "[code://packages/sdk/src/types/host.ts#L1319-L1330](../../packages/sdk/src/types/host.ts#L1319-L1330) - what `confirm` means for a host tool"
  - "[code://docs/sdk/TERMINALS.md#L72](../../docs/sdk/TERMINALS.md#L72) - the docs say the tool is never offered under Windows"
  - https://github.com/microsoft/vscode/blob/1564f100807a/src/vs/platform/agentHost/node/copilot/copilotSessionLauncher.ts#L1477 - VS Code turns the tool off on Windows
  - https://github.com/microsoft/vscode/blob/1564f100807a/src/vs/platform/agentHost/common/copilotCliConfig.ts#L243-L247 - "Not supported on Windows, where sessions use the SDK's terminal and sandbox runtime"
  - https://github.com/microsoft/vscode/commit/c7282ad3829e1a1bc8a958afd1eb258b81a0d67b - vscode#340446 removed the MXC sandbox, VS Code's Windows sandbox for its host, and added the Windows check in the same commit
---

# The agent terminal tool runs on Windows when a setting says so

Softov wants an agent on Windows to run its shell commands in a terminal the host owns, as it does on Linux and macOS: the person sees the terminal and can type into it.
Today `enableCustomTerminalTool` does nothing on Windows.
He chose on 2026-11-12: "A setting, off by default."

## What others do

- **VS Code** offers the tool on Linux and macOS, and never on Windows. It had a Windows sandbox for its host, MXC (`wxc-exec.exe`, `@microsoft/mxc-sdk`). On 2026-10-08, vscode#340446 removed MXC and added `process.platform !== 'win32'` to the tool's switch. Since then, a Windows session uses the agent SDK's own terminal and sandbox.
- **doop** opens a host terminal on Windows with `node-pty`, which uses ConPTY, and `cmd.exe` by default. Its `windows-shell` plugin runs `powershell.exe -NoProfile -NonInteractive` per command, with fixed presets, a person's approval for any other command, a timeout and an output limit. It has no process sandbox on Windows.

## What ahpd has today

- [`shellToolsFor`](../../packages/sdk/src/host/tooling.ts#L515-L526) offers the tool only when the root config sets `enableCustomTerminalTool`, the platform is not `win32`, and the host has a terminal store.
- ahpd sandboxes the tool on no platform. Its descriptions are VS Code's with the sandbox lines left out ([`shell.ts`](../../packages/sdk/src/tools/shell.ts#L13-L15)). So the Windows check is parity with VS Code, not a protection that other platforms have.
- On Windows the host opens PowerShell, and the tool set's primary is `powershell`.
- The host terminal works on Windows: the shell integration check of host/20261103-1620 passed there on 2026-11-12, in PowerShell.
- The primary tool sets no `confirm`, so the backend's approval policy decides each call, as for any tool. `read_`, `write_`, `list_` and `_shutdown` set `confirm: false`.
- The problem [backends-skip-the-operators-always-ask-rule.md](../problems/backends-skip-the-operators-always-ask-rule.md) says a `confirm: false` host tool such as `write_bash` runs with no question in Claude.

## Who writes

- `packages/sdk/src/host/tooling.ts` and the root config keys in `packages/sdk/src/vscoderootconfig.ts` have no open PR or worktree, as checked on 2026-11-12.
- `docs/sdk/TERMINALS.md` and the v0.15 release notes say "never on Windows". The change corrects both.

## The change

- A new setting, off by default, lets the tool be offered on Windows.
- With it off, nothing changes: Windows matches VS Code.
- With it on, `shellToolsFor` drops the `win32` condition, and `enableCustomTerminalTool` decides as on other platforms.
- A Windows session then gets `powershell` as the primary, with `read_powershell`, `write_powershell`, `list_powershell` and `powershell_shutdown`.
- The docs say the setting exists, that it is off by default, and that the tool runs with no sandbox on any platform.
- A check by hand on Windows runs the agent terminal tool section of host/20261103-1620 with the setting on.

## Open points

- Where the setting lives. A root config key can be pushed by any client with `config:change`. A daemon config key can be set only by the operator, which suits a choice about running commands with no sandbox.
- The setting's name.
- Whether the PowerShell form needs more than the shell integration that passed: the async commands of #213, and the prompt and sentinel lines the answer must not show.
