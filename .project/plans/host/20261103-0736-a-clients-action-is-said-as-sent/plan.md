---
title: A client's action is said as sent
domain: host
status: planned
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://cde4dd6c - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2745-L2752 - a client's action is applied and emitted as the client sent it"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L414-L428 - a customization switch, recorded with the client's own enablement"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2881-L2899 - a root push reduced as given"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4220-L4222 - every config envelope said in the client's own keys"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2475-L2492 - a session's config state stored as resolved, with no schema rewritten"
  - "[code://packages/sdk/src/host/chatactions.ts#L1626-L1675](../../../../packages/sdk/src/host/chatactions.ts#L1626-L1675) - `session/customizationToggled`, whose echo carries the enablement this host applied"
  - "[code://packages/sdk/src/host/actions.ts#L358-L373](../../../../packages/sdk/src/host/actions.ts#L358-L373) - a root push naming the restart mark, echoed with the host's value"
  - "[code://packages/sdk/src/host/chatactions.ts#L1072-L1154](../../../../packages/sdk/src/host/chatactions.ts#L1072-L1154) - `taking`, which says a backend's object answer under the backend's keys"
  - "[code://packages/sdk/src/types/session.ts#L428-L433](../../../../packages/sdk/src/types/session.ts#L428-L433) - `ConfigTaken`, with its object answer"
  - "[code://packages/sdk/src/host/sessionconfig.ts#L427-L470](../../../../packages/sdk/src/host/sessionconfig.ts#L427-L470) - `runningSchema`, which redraws every key not marked mutable as a read-only chip"
  - "[code://packages/sdk/test/session-fixed-key.test.ts#L279-L340](../../../../packages/sdk/test/session-fixed-key.test.ts#L279-L340) - the read-only chip's cases"
  - "[code://packages/sdk/test/root-config.test.ts#L955-L979](../../../../packages/sdk/test/root-config.test.ts#L955-L979) - the restart mark's case"
---

## Goal

What the host says of a client's action is the action as the client sent it, in the client's own keys.
A running session's schema is each key as its backend or plugin declared it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "enablement: applied" packages/sdk/src` - a switch's echo carries the enablement this host applied.
- `rg -n "said\[RESTART_KEY\]" packages/sdk/src` - a push naming the restart mark is echoed with the host's value.
- `rg -n "keys of its own" packages/sdk/src docs` - an object answer from `setConfig` replaces the client's key.
- `rg -n "sessionMutable: true, readOnly: true" packages/sdk/src` - the running schema's rewrite.

### Runtime path

```
session/customizationToggled -> chatactions.ts -> applied for the session -> the client's action, as sent
root/configChanged naming ahpd.restartNeeded -> actions.ts -> the client's value, as sent
session/configChanged -> chatactions.ts taking -> setConfig answers true or a sentence -> the client's keys
a running session's start -> spawn.ts -> runningSchema, the declared schema frozen
```

### Gaps

- A switch from a sender who may not keep a host-wide decision is echoed as a session decision.
- A push naming the restart mark is echoed with the host's value.
- A backend may answer a config change under keys of its own, and the echo carries them.
- A running session redraws every key not marked mutable as a read-only chip.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A client's action "is applied to state and emitted with the client's origin", as sent | [agentHostStateManager.ts#L2745-L2752](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2745-L2752) | 01 |
| A switch is recorded with `action.enablement`, the client's own, so a VS Code client holds the enablement it sent | [agentSideEffects.ts#L414-L428](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L414-L428) | 01 |
| What this host applies for a sender without `config:change` is its grants' own decision, kept as it is | [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) | 01 |
| A root push is reduced as given, `rootReducer(this._rootState, action)`; its settings editor writes every root property back on a save | [agentHostStateManager.ts#L2881-L2899](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2881-L2899); [agentHostSettingsFileSystemProvider.ts#L52-L67](https://github.com/microsoft/vscode/blob/8fb60541db0e1a371ea40157e0f58951ae4a485d/src/vs/sessions/contrib/providers/agentHost/browser/agentHostSettingsFileSystemProvider.ts#L52-L67) | 01 |
| Every config envelope goes out in the listener's own keys: `sessionConfigAdapter.toClientAction(envelope.action, ...)`, "authoritative state remains host-native" | [protocolServerHandler.ts#L4220-L4222](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4220-L4222); [protocolServerHandler.ts#L587-L599](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/protocolServerHandler.ts#L587-L599) | 01 |
| No backend here answers `setConfig` with an object, so the answer is `true` or a sentence | [`code://packages/agent-claude/src/session/config.ts`](../../../../packages/agent-claude/src/session/config.ts) | 01 |
| A session's config state is stored as its agent resolved it, `entry.state.config = config`, and no schema is redrawn, so a VS Code window draws no chip for a key that may not move | [agentHostStateManager.ts#L2475-L2492](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2475-L2492) | 01 |

## Proposed architecture

- **State flow** - an echo is the client's action; a running session's schema is the declared one.
- **Layer responsibilities** - sdk: the toggle, the root push, `taking`, `ConfigTaken` and `runningSchema`.
- **Source-of-truth files** - [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts), [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts), [`code://packages/sdk/src/host/sessionconfig.ts`](../../../../packages/sdk/src/host/sessionconfig.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Each echo is the client's action](task-01-each-echo-is-the-clients-action.md) | todo | - |

## Risks and tradeoffs

- A stale save of the root config sets the restart mark every reader holds, as a push of any root value does.
- A running session shows no chip for a key that may not move, as under the reference host.

## Resume state

- **Done so far:** nothing.
- **Next action:** task 01.
- **Open questions:** none.
- **Watch out for:** the restart mark itself stays the daemon's answer, kept by `markRestart`.

## Final verification checklist

- [ ] The changed cases fail on `cde4dd6c` for the reasons they name, and pass after the change.
- [ ] The tools, root config, session config and fixed key test files pass.
- [ ] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
