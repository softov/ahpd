---
title: An active client entry is taken as sent
domain: host
status: planned
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://cde4dd6c - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L2008-L2011 - the reference host takes a set as sent"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2745-L2752 - and applies a client's action as it was sent"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/reducer.ts#L264-L273 - the reducer upserts the entry under the `clientId` it carries"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1659-L1677 - a leaving client's own entry is removed, by its id"
  - "[code://packages/sdk/src/host/actions.ts#L831-L871](../../../../packages/sdk/src/host/actions.ts#L831-L871) - `session/activeClientSet`, which gives an entry naming no client the sender's id"
  - "[code://packages/sdk/src/host.ts#L1321-L1331](../../../../packages/sdk/src/host.ts#L1321-L1331) - `leaves`, which names the entry it removes by the id it carries"
  - "[code://packages/sdk/test/presence.test.ts#L316-L345](../../../../packages/sdk/test/presence.test.ts#L316-L345) - the case of an entry naming another client"
---

## Goal

A `session/activeClientSet` is taken as sent: an entry that names no client is held with no `clientId`, as the reducer keys it.
A client's leaving takes out the entry under its own id, so such an entry stays until a set replaces it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "the sender's where it carries none" packages/sdk/src` - an entry naming no client takes the sender's id.
- `rg -n "const named = held.get" packages/sdk/src/host.ts` - `leaves` names its removal by the entry's own id.
- VS Code at `a4e689ae`: no check on `SessionActiveClientSet` in its protocol handler, its service or its state manager.

### Runtime path

```
session/activeClientSet -> actions.ts -> presence, under the clientId the entry carries -> said to every client
a client unsubscribes or goes -> host.ts leaves -> the entry under its own id -> session/activeClientRemoved
```

### Gaps

- An entry with no `clientId` is held and said with the sender's id, where the reference host holds it as sent.

## Answers

| What | Source | Task |
| --- | --- | --- |
| VS Code's host takes the set as sent: `case ActionType.SessionActiveClientSet: { this._fanOutActiveClient(channel, action.activeClient); break; }`, with no `clientId` check in its protocol handler, service or state manager | [agentSideEffects.ts#L2008-L2011](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L2008-L2011) | 01 |
| A client's action "is applied to state and emitted with the client's origin" | [agentHostStateManager.ts#L2745-L2752](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2745-L2752) | 01 |
| The reducer keys the entry by the `clientId` it carries: `list.findIndex(c => c.clientId === action.activeClient.clientId)` | [reducer.ts#L264-L273](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/reducer.ts#L264-L273) | 01 |
| A leaving client's removal is by its own id, `this._isActiveClient(state, clientId)`, so an entry naming no client stays | [protocolServerHandler.ts#L1659-L1677](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1659-L1677) | 01 |
| An entry naming no client provides no tools and no plugins: `clientTools` and the plugin reader take an entry's id as the tools' owner, and skip one with none | [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts) | 01 |

## Proposed architecture

- **State flow** - the presence map is keyed by the `clientId` each entry carries, absent included, as the reducer keys `activeClients`.
- **Layer responsibilities** - sdk: the action's handler, `leaves`, and the presence map's type.
- **Source-of-truth files** - [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts), [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - An entry naming no client is held as sent](task-01-an-entry-naming-no-client-is-held.md) | todo | - |

## Risks and tradeoffs

- An entry naming no client stays in the session's `activeClients` until a set replaces it, as on the reference host.

## Resume state

- **Done so far:** nothing.
- **Next action:** task 01.
- **Open questions:** none.
- **Watch out for:** a creator's entry is refused unless it names the connection, so `createSession` holds none without an id.

## Final verification checklist

- [ ] The new case fails on `cde4dd6c` for the reason it names, and passes after the change.
- [ ] The presence test file passes.
- [ ] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
