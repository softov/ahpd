---
title: "`@` lists files without `rg` on the PATH"
created: 2026-11-09
refs:
  - git://39620ef99 - the commit of ahpd the facts were checked at
  - git://c4a3b4861 - `@` lists files with ripgrep, as VS Code's provider does
  - "[code://packages/sdk/src/resources/workspacefiles.ts#L36-L45](../../packages/sdk/src/resources/workspacefiles.ts#L36-L45) - `ripgrepFiles(command = 'rg')` spawns `rg` from the PATH"
  - "[code://packages/sdk/src/resources/workspacefiles.ts#L135-L141](../../packages/sdk/src/resources/workspacefiles.ts#L135-L141) - a spawn that fails rejects the listing"
  - "[code://packages/sdk/src/host/filecompletions.ts#L112-L119](../../packages/sdk/src/host/filecompletions.ts#L112-L119) - a rejected listing is logged and answered as no files"
  - "[code://packages/server/src/commands/run.ts#L1323](../../packages/server/src/commands/run.ts#L1323) - the daemon passes `ripgrepFiles()` with no command"
  - "[code://packages/server/src/doctor.ts#L44](../../packages/server/src/doctor.ts#L44) - the doctor's checks, with none for `rg`"
  - "[code://packages/sdk/src/resources/resources.ts#L233-L245](../../packages/sdk/src/resources/resources.ts#L233-L245) - `complete`, the directory listing `@` used before c4a3b4861"
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/agentHostWorkspaceFiles.ts#L14 - VS Code's agent host runs the `rg` it ships
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/package.json#L127 - `@vscode/ripgrep-universal` is a dependency of VS Code
  - npm://@earendil-works/pi-coding-agent@1.3.0 - `dist/utils/tools-manager.js` finds `rg` or downloads it at first use
---

# `@` lists files without `rg` on the PATH

Softov typed `@host` in a session on his dev daemon and got "No matches". The daemon's PATH has no `rg`, so every listing failed, and no client said why. The goal is that `@` lists the files on a machine where nobody installed ripgrep.
At the least, the person is told what is missing and how to fix it.

## What others do

- VS Code ships its own `rg`. Its agent host runs `rgDiskPath` from `base/node/ripgrep`, the program of its `@vscode/ripgrep-universal` dependency. A person never installs ripgrep.
- pi finds `rg` or fetches it. `tools-manager.js` looks in `~/.pi/agent/bin`, then on the PATH (L84). With neither, it downloads the latest release of `BurntSushi/ripgrep` from GitHub into `~/.pi/agent/bin` (L43, L100, L243). Softov's machine has pi's copy, ripgrep 15.2.0.

## What ahpd has today

- `@` lists files only through `rg`. The daemon calls `ripgrepFiles()`, which spawns `rg` from the PATH ([`code://packages/server/src/commands/run.ts`](../../packages/server/src/commands/run.ts#L1323)).
- `ripgrepFiles` takes the program as an argument, but nothing sets it ([`code://packages/sdk/src/resources/workspacefiles.ts`](../../packages/sdk/src/resources/workspacefiles.ts#L36-L45)).
- A missing `rg` rejects the listing ([`code://packages/sdk/src/resources/workspacefiles.ts`](../../packages/sdk/src/resources/workspacefiles.ts#L135-L141)). The host logs `Failed to enumerate <folder>` at error, and the client gets no files ([`code://packages/sdk/src/host/filecompletions.ts`](../../packages/sdk/src/host/filecompletions.ts#L112-L119)).
- `ahpd doctor` checks the runtime, the config, the daemon, the service, the plugins, the agents and the update, and not `rg` ([`code://packages/server/src/doctor.ts`](../../packages/server/src/doctor.ts#L44)).
- Before c4a3b4861, `@` listed one directory at a time with `complete`, in Node, with no program ([`code://packages/sdk/src/resources/resources.ts`](../../packages/sdk/src/resources/resources.ts#L233-L245)). It is still in the sdk.
- ahpd already runs `git` from the PATH, as `gitBranches` does ([`code://packages/sdk/src/resources/workspacefiles.ts`](../../packages/sdk/src/resources/workspacefiles.ts#L36-L38)).

## Who writes

- MayCXC wrote c4a3b4861, which added `ripgrepFiles` and the file completions. No branch of his touches these files after it.
- No open PR and no other worktree touches `workspacefiles.ts`, `filecompletions.ts` or `doctor.ts`.

## The change

- `ahpd doctor` says when `rg` is not found, with the fix for the system.
- The daemon config names the `rg` program, as `ripgrepPath`. Without it, `rg` comes from one of the ways below.
- `@` lists files in one of these ways when `rg` is not on the PATH:

| Way | What | Cost |
| --- | --- | --- |
| 1. The person installs it | `apt install ripgrep`, `brew install ripgrep` or `winget install BurntSushi.ripgrep.MSVC`. The doctor says which. | One step for each person on each machine. `@` is empty until then. |
| 2. The person names a copy | `ripgrepPath` points at an `rg` the machine has, such as pi's `~/.pi/agent/bin/rg`. | Nothing to install, but the person must know a copy exists. |
| 3. ahpd brings its own | As VS Code, a dependency on `@vscode/ripgrep`, which fetches `rg` at install. Or as pi, a download at first use into ahpd's data folder. | `@` works at once. A new dependency, or a download from GitHub on a machine that may be offline. |
| 4. ahpd lists without `rg` | `git ls-files --cached --others --exclude-standard` in a git folder, which honours `.gitignore` as `rg` does, and `complete` elsewhere. | No new program. A folder that is not a git repository lists one directory at a time. |

## Open points

- Which way, or which ways in order, such as 2, then 3 or 4. Way 3 adds a dependency or a download, which is Softov's call.
- The install command for each system in the doctor's fix is not checked yet.
- Whether a client can be told why `@` found nothing. The completion answer carries items only; a notice there is not checked against the protocol.
