---
title: The edit locations reach the backends
domain: host
status: built
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://cde4dd6c - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L520-L528 - the host-owned keys, which are the only ones the reference host keeps from its agents"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L1831-L1836 - a provider is handed the config with the host-owned keys omitted"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L2306-L2307 - its Claude agent keeps the key among its own"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentConfigurationService.ts#L205-L217 - an agent reads a key's effective value, the first layer that validates"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentConfigurationService.ts#L544-L566 - each layer's value is validated whole and a malformed one skipped"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1355-L1369 - the layers are the session's values, then the host's"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/agentHostSchema.ts#L194-L230 - the validator: an array of objects, each with its required `path` and `isDirectory`"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1024-L1026](../../../../packages/sdk/src/host/lifecycle.ts#L1024-L1026) - `backendsOwn`, which keeps the key out of every backend's start"
  - "[code://packages/sdk/src/host/chatactions.ts#L1116-L1153](../../../../packages/sdk/src/host/chatactions.ts#L1116-L1153) - `taking`, which never hands the key to a backend"
  - "[code://packages/sdk/src/host/spawn.ts#L964-L969](../../../../packages/sdk/src/host/spawn.ts#L964-L969) - the command check, which keeps the well-formed entries of a malformed value"
  - "[code://packages/sdk/src/host/common.ts#L55-L86](../../../../packages/sdk/src/host/common.ts#L55-L86) - `HOSTS_TAKEN`"
  - "[code://packages/sdk/test/autoapproval.test.ts#L259-L290](../../../../packages/sdk/test/autoapproval.test.ts#L259-L290) - the locations' case"
---

## Goal

`sensitiveEditLocations` reaches every backend, at its start and as the key moves, as VS Code's host hands its agents every key but its own.
The command check reads the locations whole: a value that does not fit the property's shape is no locations.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "HOSTS_TAKEN" packages/sdk/src` - the key is kept out of `backendsOwn` and out of the keys a backend is asked about.
- `rg -n "sensitiveEditLocations" packages/sdk/src/host/spawn.ts` - the check keeps each well-formed entry of a value.
- VS Code at `a4e689ae`: `agentConfigurationService.ts`, read for this plan, holds `getEffectiveValue` and `_firstValid`.

### Runtime path

```
createSession or a restart -> backendsOwn(config) -> Start.settings, the key included
session/configChanged of the key -> chatactions.ts taking -> the host takes it -> every chat's setConfig
a command line -> spawn.ts getAutoApproval -> the locations, whole or none -> the redirect check
```

### Gaps

- The key is kept from every backend's start and change, so a nested session's host inside never has the locations.
- The check keeps the well-formed entries of a malformed value, where the reference host skips the value.

## Answers

| What | Source | Task |
| --- | --- | --- |
| VS Code's host keeps from its agents only `HOST_OWNED_SESSION_CONFIG_KEYS`: Agent Merge's, isolation, branch, the worktree keys and the pull request URL | [agentService.ts#L520-L528](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L520-L528); [agentService.ts#L1831-L1836](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L1831-L1836) | 01 |
| So a backend's start config carries the key | [claudeAgent.ts#L2306-L2307](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L2306-L2307) | 01 |
| An agent there reads a key's value as it stands when it reads it, so a change reaches it; here a backend learns a change by `setConfig`, and its answer decides nothing, since this host takes the key | [agentConfigurationService.ts#L205-L217](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentConfigurationService.ts#L205-L217) | 01 |
| A value is read whole: "Layers that provide a malformed value are logged and skipped", `schema.assertValid(key, raw)` on the whole value | [agentConfigurationService.ts#L544-L566](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentConfigurationService.ts#L544-L566) | 02 |
| The shape is the property's: an array, each item an object with a string `path` and a boolean `isDirectory`, both required | [agentHostSchema.ts#L194-L230](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/agentHostSchema.ts#L194-L230); [agentHostSchema.ts#L347-L367](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/agentHostSchema.ts#L347-L367) | 02 |
| The next layer is the host's root config, which here takes only the keys its schema declares, and it declares no `sensitiveEditLocations`, so a malformed value is no locations | [agentConfigurationService.ts#L1355-L1369](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1355-L1369); [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) | 02 |
| A write of the key is taken as sent: the reference host checks only its approval key on a write | [agentService.ts#L13563-L13606](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L13563-L13606) | - |

## Proposed architecture

- **State flow** - the key rides the session's config into every start, and every chat's `setConfig` as it moves.
- **Layer responsibilities** - sdk: `backendsOwn`, `taking`, and the command check.
- **Source-of-truth files** - [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts), [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts), [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The key reaches every backend](task-01-the-key-reaches-every-backend.md) | done | - |
| [02 - The locations are read whole](task-02-the-locations-are-read-whole.md) | done | - |

## Risks and tradeoffs

- A backend that does not take the key answers `setConfig` with a refusal, which this host drops.

## Resume state

- **Done so far:** tasks 01 and 02, 2026-11-03.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** a restart already starts the backend on the session's config, so only `taking` hands a change.

## Final verification checklist

- [x] The new cases fail on `cde4dd6c` for the reasons they name, and pass after the change.
- [x] The autoapproval and command approver test files pass.
- [x] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
