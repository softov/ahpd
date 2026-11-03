---
title: A woken session shows its running config
domain: host
status: planned
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://c97d8459 - the commit of ahpd this plan was checked at
  - git://c97d8459 - the last commit that holds .project/problems/a-held-chat-state-misses-its-schema-after-a-wake.md, which this plan covers
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L13928-L13932 - a restore of a session whose state is held rebuilds nothing"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L14864-L14882 - a restore resolves the config with the agent, the persisted values over its defaults, and asks the agent for its customizations"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L14891-L14905 - and lays both into the new state"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L10960-L10981 - `_resolveCreatedSessionConfig`, the one call a create and a restore resolve the config with"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L7885-L7889 - a state loaded with no agent is seen by no client, and is dropped before it is opened"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L14884-L14889 - and its config is resolved by the same call"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L14650-L14660 - the store keeps a session's config values, and the schema is the agent's"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2476-L2492 - the resolved config is set on the state before its first snapshot"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L609-L647 - an agent's customizations are said on a held state whenever they differ from the state's"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L6419-L6422 - a new session's first list is said to the clients that subscribed while it was read"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/actions.ts#L614-L620 - `session/configChanged` carries values, and no action carries a schema"
  - "[code://packages/sdk/src/host/snapshots.ts#L728-L737](../../../../packages/sdk/src/host/snapshots.ts#L728-L737) - a state read from the record takes the static schema and the stored values"
  - "[code://packages/sdk/src/host/snapshots.ts#L152-L164](../../../../packages/sdk/src/host/snapshots.ts#L152-L164) - a running state takes the backend's config, with this host's own keys laid on"
  - "[code://packages/sdk/src/host/spawn.ts#L1122-L1125](../../../../packages/sdk/src/host/spawn.ts#L1122-L1125) - what a backend starts with: its defaults, a plugin's defaults, the config"
  - "[code://packages/sdk/src/host/sleep.ts#L295](../../../../packages/sdk/src/host/sleep.ts#L295) - a wake hands the stored config"
  - "[code://packages/sdk/src/host/spawn.ts#L1893-L1908](../../../../packages/sdk/src/host/spawn.ts#L1893-L1908) - a held state is kept at a start, and only the session's chat row is said again"
---

## Goal

A session's state read from its record holds the config its backend runs with.
A wake keeps that state, so the config a client draws is the same before and after the wake.
The backend a wake starts says its customizations on the held state, where they differ from it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `recordSeed`, `sessionSeed`, `chatMoved`, `factsMoved`, `laidCustomizations` and `reportedBy` in `packages/sdk/src/host`.
- The backends' `sessionState` in `packages/agent-claude`, `packages/agent-pi`, `packages/agent-acp`, `packages/agent-cofold` and `examples`.
- VS Code at `a4e689ae`: `restoreSession`, `_doRestoreSession` and `_restoreSessionState` in agentService.ts, and `_resolveCreatedSessionConfig`.
- VS Code at `a4e689ae`: `setSessionConfig` and `setSessionCustomizations` in agentHostStateManager.ts, and their callers.
- VS Code at `a4e689ae`: `_publishSessionCustomizations` in agentSideEffects.ts, and what the session state stores keep.
- The spec at `v1.0.0`: every session and chat action, for one that carries a schema.

### What VS Code's host does

- A restore builds a session's state from its agent, and resolves the config with the call a create uses.
  The stored values go over the agent's defaults.
- It lays the config and the agent's customizations into the new state before any client reads it.
- The store keeps only the values; the schema is the agent's answer at each restore.
- A restore of a held state rebuilds nothing, and a state loaded without its agent is seen by no client.
- An agent's customizations are said on a held state whenever they differ from the state's.

### What ahpd does

- A state read from the record takes `sessionSchema` and the stored values over the backend's defaults.
- It leaves out a plugin's defaults, which a running backend starts with, and this host's own keys, which a running state lays on.
- A wake keeps a held state, and says only its chat row again, with the folder's `_meta` and changesets.
- A backend a wake starts says its customizations only where they move from the list it starts with.

### Runtime path

```
subscribe -> recordSeed -> a held state with the record's config
chat/turnStarted -> wake -> spawn -> a held state is kept -> chatMoved
```

### Gaps

- A session read from its record and then woken draws other controls than the one that ran, and no action can carry the difference.
- A list the backend starts with that differs from the held state's is said by nobody.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A state read from the record holds the config a running state holds: the schema with a plugin's keys, the backend's and a plugin's defaults, the stored values, and this host's own keys | [agentService.ts#L14864-L14898](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L14864-L14898); [#L10960-L10981](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L10960-L10981) | 01 |
| A wake says no schema: the spec has no action that carries one, and the held state already holds the running one | [actions.ts#L614-L620](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/actions.ts#L614-L620); [agentService.ts#L13928-L13932](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L13928-L13932) | 01 |
| A start of a session's lead under a held state says the backend's customizations by `session/customizationsChanged`, where they differ from the state's | [agentSideEffects.ts#L609-L647](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L609-L647); [agentService.ts#L6419-L6422](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L6419-L6422) | 01 |
| The config values are said by nobody at a wake, since the record and the backend compose them from one store | (defaulted: nothing differs to say once both compose the config the same way) | 01 |

## Proposed architecture

- **State flow** - the record's state composes the config as a running state does, and a start under a held state compares the lead's customizations.
- **Layer responsibilities** - sdk host: `recordSeed` in the snapshots area, and the comparison at the end of `spawn`.
- **Source-of-truth files** - [`code://packages/sdk/src/host/snapshots.ts`](../../../../packages/sdk/src/host/snapshots.ts), [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The record holds the running config](task-01-the-record-holds-the-running-config.md) | todo | - |

## Risks and tradeoffs

- A backend's first list is what it learned at boot until its own process answers.
  A state kept across a sleep shows that first list from the wake until the backend's own list comes.

## Resume state

- **Done so far:** nothing.
- **Next action:** task 01.
- **Open questions:** none.
- **Watch out for:** a session the host decided no keys for, which a restart leaves with the backend's config alone.

## Final verification checklist

- [ ] Each new case fails on `c97d8459`'s sources and passes after the change.
- [ ] The touched files' test files pass, one file at a time.
- [ ] The wake cases pass on a merge of this branch and the residency branch.
- [ ] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
