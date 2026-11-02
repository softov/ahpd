---
title: The window keys are one value for the host
domain: host
status: built
priority: high
created: 2026-11-02
revalidated: 2026-11-02
changes:
  - specs/workspace-trust.md
  - specs/people-roles-and-grants.md
refs:
  - git://60fa2ccd - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/common/agentHostManagedSettings.ts#L20-L23 - global layers only, because the agent host is shared by every window connected to it"
  - "https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/common/agentHostConfigurationSync.ts#L47-L55 - the root config is shared by every window connected to a host, last writer wins"
  - "https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2888-L2899 - one root state, reduced from every push"
  - "https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentHostSessionPrewarmer.ts#L162 - a session's trust is read from the root's one value"
  - "https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/copilot/copilotSessionLauncher.ts#L503-L511 - and so is a launch's"
  - "https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/sessionPermissions.ts#L361 - the terminal check reads the root's one value"
  - "https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/sessionPermissions.ts#L884 - and the edit patterns"
  - "https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L949-L960 - and a terminal's shell"
  - "[code://packages/sdk/src/host/gate.ts#L301-L368](../../../../packages/sdk/src/host/gate.ts#L301-L368) - `PER_CONNECTION` and the grants a push of those keys needs"
  - "[code://packages/sdk/src/host/actions.ts#L339-L411](../../../../packages/sdk/src/host/actions.ts#L339-L411) - a push writes those keys to the pushing connection"
  - "[code://packages/sdk/src/host.ts#L663-L738](../../../../packages/sdk/src/host.ts#L663-L738) - `seenBy` shows those keys to the sender alone"
  - "[code://packages/sdk/src/host/root.ts#L689-L717](../../../../packages/sdk/src/host/root.ts#L689-L717) - `rootFor` lays a connection's own over the root state"
  - "[code://packages/sdk/src/host/spawn.ts#L887-L968](../../../../packages/sdk/src/host/spawn.ts#L887-L968) - trust and approvals read the sending connection's values"
  - "[code://packages/sdk/src/host/trust.ts#L212-L230](../../../../packages/sdk/src/host/trust.ts#L212-L230) - `requireTrust` reads the sending connection's trust"
  - "[code://packages/sdk/src/host/terminals.ts#L468](../../../../packages/sdk/src/host/terminals.ts#L468) - a client's terminal opens its connection's shell"
  - "[code://packages/sdk/src/host/terminals.ts#L228-L238](../../../../packages/sdk/src/host/terminals.ts#L228-L238) - a backend's terminal opens the daemon's own shell"
---

## Goal

Each of the window's keys in root config is one value for the whole host, as VS Code's host holds them.
The last push from any window sets it.
The keys are `defaultShell`, `workspaceTrust`, `terminalAutoApproveEnabled`, `terminalAutoApproveRules` and `editAutoApprovePatterns`.
Every client reads the same values, and every reader on the host reads them: a client's terminal, a session's trust, and a session's approvals.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "PER_CONNECTION|connection.config|sender.config" packages/sdk/src` - every place a window key is kept or read.
- A push writes the five keys to the pushing connection, and `seenBy` and `rootFor` show each connection its own.
- A turn's trust and approvals read the sending connection's values, and a start with no connection reads none.
- A client's terminal opens its own connection's `defaultShell`, and a backend's terminal the daemon's own shell.
- The gate needs no grant for four of the keys, because they changed nothing anybody else reads; `workspaceTrust` needs `trust:push`.
- VS Code main at `a1254744` keeps one root config for every window, and reads each key with `getRootValue` wherever it reads it.

### Runtime path

```
root/configChanged -> actions.ts -> rootConfig -> one echo to every root subscriber
  -> spawn.ts trust and approvals, trust.ts requireTrust, terminals.ts createTerminal -> rootConfig
```

### Gaps

- Two windows that push different values each see their own under this host, and the last push of any window under VS Code's host.
- A turn's approval and a folder's trust follow the sending window here, and the last push there.
- So a confirmation shows under one host and not under the other.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Each window key is one value for the whole host, which the last push sets | [agentHostManagedSettings.ts#L20-L23](https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/common/agentHostManagedSettings.ts#L20-L23); [agentHostStateManager.ts#L2888-L2899](https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2888-L2899) | 01 |
| Every client reads the same values, in the root state and in the echo of a push | [agentHostConfigurationSync.ts#L47-L55](https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/common/agentHostConfigurationSync.ts#L47-L55) | 01 |
| A session's trust, and `requireTrust`, read the host's `workspaceTrust` | [agentHostSessionPrewarmer.ts#L162](https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentHostSessionPrewarmer.ts#L162) | 01 |
| A session's command and edit approvals read the host's rules | [sessionPermissions.ts#L361](https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/sessionPermissions.ts#L361); [sessionPermissions.ts#L884](https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/sessionPermissions.ts#L884) | 01 |
| A client's terminal opens the host's `defaultShell` | [agentHostTerminalManager.ts#L949-L960](https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L949-L960) | 01 |
| On a host with no people, a start no window sent reads the host's values too | [agentHostSessionPrewarmer.ts#L162](https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentHostSessionPrewarmer.ts#L162) | 01 |
| On a host with people, a turn reads trust and rules only when the session's owner sends it, as now | `(defaulted: VS Code's host has no people, so the owner check stays as it is)` | 01 |
| A push of a window key needs `config:change`, and a push of `workspaceTrust` alone `trust:push` | `(defaulted: a key every session reads changes the host for everybody, which the gate asks config:change of; the trust row stays)` | 01 |
| The folders a window said yes to one at a time stay on its connection | `(defaulted: VS Code's host keeps no such answer, and the record here stays as it is)` | 01 |
| A backend's terminal opens the daemon's own shell, as now | [code://packages/sdk/src/host/terminals.ts#L228-L238](../../../../packages/sdk/src/host/terminals.ts#L228-L238) | 01 |
| The docs and the two specs say the keys are the host's | [code://packages/sdk/src/host/gate.ts#L301-L368](../../../../packages/sdk/src/host/gate.ts#L301-L368) | 02 |

## Proposed architecture

- **State flow** - `rootConfig` holds the five keys with the rest, and the root state every client reads holds the same.
- **Event flow** - one echo of a push goes to every root subscriber, the same for each.
- **Layer responsibilities** - `actions.ts` keeps a push; `spawn.ts`, `trust.ts` and `terminals.ts` read `rootConfig`; `gate.ts` asks the grant.
- **Source-of-truth files** - [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts), [`code://packages/sdk/src/host/gate.ts`](../../../../packages/sdk/src/host/gate.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The host holds the window keys](task-01-the-host-holds-the-window-keys.md) | done | - |
| [02 - The docs and specs say so](task-02-the-docs-and-specs-say-so.md) | done | 01 |

## Risks and tradeoffs

- A person holding `trust:push` sets the trust every session on the host reads; VS Code's host has no grants to say otherwise.
- On a host with people, a member's window pushes its keys and is refused without `config:change`, so the operator's values hold.
- On a host with no people, an automation and a restarted session read the host's trust and rules, where they read none before.

## Resume state

- **Done so far:** tasks 01 and 02, 2026-11-02.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** `snapshotOf` and `rootFor` lose the connection's own values as a parameter, and every caller moves with them.

## Final verification checklist

- [x] Each changed case fails on `60fa2ccd` for the reason it names, and passes after the change.
- [x] The touched suites pass.
- [x] `pnpm run typecheck`, `pnpm run boundary` and `pnpm i18n` report no errors, and the prose lint is clean.
