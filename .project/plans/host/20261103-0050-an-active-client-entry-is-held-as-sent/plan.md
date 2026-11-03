---
title: An active client entry is held as sent
domain: host
status: active
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://f419294d - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/actions.ts#L231-L251 - a client dispatches this action with its own entry, upserted by `clientId`, and the text names no answer of the host's"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/session-channel.md#L160-L169 - the session channel's validation rules, none of them for `session/activeClientSet`"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/reducer.ts#L264-L274 - the reducer upserts the entry under the `clientId` it carries"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L2008-L2011 - the reference host takes the entry as sent"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1659-L1677 - and removes a leaving client's own entry, by its id"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostActiveClientService.ts#L259-L275 - every VS Code client builds its entry from its connection's own `clientId`"
  - "[code://packages/sdk/src/host/actions.ts#L804-L880](../../../../packages/sdk/src/host/actions.ts#L804-L880) - `session/activeClientSet`, which refuses an entry naming another client"
  - "[code://packages/sdk/test/presence.test.ts#L314-L338](../../../../packages/sdk/test/presence.test.ts#L314-L338) - the case of an entry naming another client"
---

## Goal

A `session/activeClientSet` is taken as sent, its entry held under the `clientId` it carries.
A client's leaving takes out its own entry and no other.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "is another client" packages/sdk/src` - the host refuses an entry naming another client's id.
- `rg -n "const leaves" packages/sdk/src/host.ts` - a client's leaving takes out the entry held under its own id.
- VS Code main at `a4e689ae`: its host checks no `clientId` on the action, and its clients send their own.

### Runtime path

```
session/activeClientSet -> actions.ts -> presence, under the entry's clientId -> said to every client
a client unsubscribes or goes -> host.ts leaves -> its own entry out -> session/activeClientRemoved
```

### Gaps

- An entry naming another client is refused, where the reference host takes it as sent.

## Answers

| What | Source | Task |
| --- | --- | --- |
| No VS Code client sends an entry naming another client, so none can tell whether a host takes one | [agentHostActiveClientService.ts#L259-L275](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostActiveClientService.ts#L259-L275); [agentHostSessionHandler.ts#L1160](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L1160) | 01 |
| The specification's text describes a client's own entry and names no answer of the host's for one naming another: its validation rules for the session channel hold none for this action, and its reducer upserts any entry | [actions.ts#L231-L251](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/actions.ts#L231-L251); [session-channel.md#L160-L169](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/session-channel.md#L160-L169); [reducer.ts#L264-L274](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/reducer.ts#L264-L274) | 01 |
| So the reference host is the rule: the entry is taken as sent and held under its own `clientId` | [agentSideEffects.ts#L2008-L2011](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L2008-L2011) | 01 |
| A client's leaving takes out the entry under its own id, so the sender's leaving leaves an entry naming another client in place | [protocolServerHandler.ts#L1659-L1677](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1659-L1677) | 01 |
| An entry with no `clientId` takes the sender's, as before | `(defaulted: the item is an entry naming another client)` | - |

## Proposed architecture

- **State flow** - the session's active clients are keyed by the `clientId` each entry carries.
- **Layer responsibilities** - sdk: the action's handler.
- **Source-of-truth files** - [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - An entry naming another client is held as sent](task-01-an-entry-naming-another-is-held.md) | todo | - |

## Risks and tradeoffs

- A client can put an entry under another client's id, whose tools are then that client's to run, as on the reference host.

## Resume state

- **Done so far:** nothing yet.
- **Next action:** task 01.
- **Open questions:** none.
- **Watch out for:** the presence map is the host's copy of the reduced list, so its key is the entry's `clientId`.

## Final verification checklist

- [ ] The changed case fails on `f419294d` for the reason it names, and passes after the change.
- [ ] The presence test file passes.
- [ ] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
