---
title: An active client keeps the tools it sent
domain: host
status: built
priority: high
created: 2026-11-02
revalidated: 2026-11-02
refs:
  - git://89ebe4d5 - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/reducer.ts#L264-L273 - the reducer upserts the entry the action carries, as it carries it"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/state.ts#L267-L283 - `SessionActiveClient` and its `tools`"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2750-L2752 - a client's set is applied as the client sent it"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentService.ts#L6404 - a session's creator is held as it sent its entry"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentSideEffects.ts#L545-L566 - each chat's agent is handed the entry's `tools` as they came"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/activeClientState.ts#L28-L35 - an absent list and an empty one compare equal"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/activeClientState.ts#L89-L92 - and a client with no list contributes none"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostCustomizationService.ts#L1083-L1101 - the workbench reads every active client's `tools`"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts#L4256-L4262 - the Sessions window compares its own entry whole"
  - "[code://packages/sdk/src/host/actions.ts#L802-L811](../../../../packages/sdk/src/host/actions.ts#L802-L811) - a set's `tools` filled with none when the client left them out"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1060-L1067](../../../../packages/sdk/src/host/sessionmethods.ts#L1060-L1067) - and the creator's entry the same"
  - "[code://packages/sdk/src/host/tooling.ts#L584-L599](../../../../packages/sdk/src/host/tooling.ts#L584-L599) - the tools a session's clients provide, read as none where an entry has no list"
---

## Goal

A client's `session/activeClientSet` entry is held, echoed and shown as the client sent it, `tools` included.
An entry sent with no `tools` is held with no `tools`.
The creator's entry in `createSession` is held the same way.
A client with no `tools` provides no tool to the session's chats.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "carried.tools|claimed.tools" packages/sdk/src` - the two places that fill `tools` with none.
- `rg -n "client.tools" packages/sdk/src` - `clientTools` and `offersSendRemoteMessage` read an absent list as none already.
- The fill's comment calls `tools` a field of an answer the client left out, and cites a reconciliation line about conflicts between two clients.
- VS Code main at `58a595f7` reduces the entry as sent and hands each chat's agent the entry's `tools` as they came.
- Its workbench lists an agent file's tools by reading `tools` of every active client of the session.

### Runtime path

```
dispatchAction session/activeClientSet -> actions.ts -> presence -> dispatch -> every client of the session
createSession activeClient -> sessionmethods.ts -> presence -> dispatch
presence -> tooling.ts clientTools -> the tools each chat is handed
```

### Gaps

- This host fills `tools: []` into an entry that names no tools, in the state, the echo and every snapshot.
- VS Code's host keeps the entry as the client sent it.
- A VS Code window reads `tools` of every active client, so an entry sent with no `tools` reads differently under the two hosts.
- So the reference host's entry is the one to hold.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A set is held, echoed and shown as the client sent it, `tools` included or left out | [agentHostStateManager.ts#L2750-L2752](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2750-L2752); [reducer.ts#L264-L273](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/reducer.ts#L264-L273) | 01 |
| The creator's entry in `createSession` is held the same way | [agentService.ts#L6404](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentService.ts#L6404) | 01 |
| A VS Code window reads every client's `tools`, so the reference host decides | [agentHostCustomizationService.ts#L1083-L1101](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostCustomizationService.ts#L1083-L1101) | 01 |
| A client with no `tools` provides no tool to the session's chats | [activeClientState.ts#L89-L92](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/activeClientState.ts#L89-L92); [code://packages/sdk/src/host/tooling.ts#L584-L599](../../../../packages/sdk/src/host/tooling.ts#L584-L599) | 01 |
| The `clientId` of a set stays the connection's, and a set naming another client stays refused | [code://packages/sdk/src/host/actions.ts#L788-L811](../../../../packages/sdk/src/host/actions.ts#L788-L811) | 01 |

## Proposed architecture

- **State flow** - `presence` holds the entry as the client sent it, with the connection's `clientId`.
- **Event flow** - the echo and every snapshot carry that entry.
- **Layer responsibilities** - `actions.ts` and `sessionmethods.ts` build the entry; `tooling.ts` reads its `tools`.
- **Source-of-truth files** - [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts), [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The entry keeps the tools it was sent](task-01-the-entry-keeps-the-tools-it-was-sent.md) | done | - |

## Risks and tradeoffs

- A VS Code window lists an agent file's tools by reading `tools` of every active client.
- An entry another client sends with no `tools` breaks that listing, as it does under VS Code's host.
- Every VS Code window sends `tools` in its own entry.

## Resume state

- **Done so far:** task 01, 2026-11-02.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** the held entry is compared with the next set by its JSON, so a set sent again unchanged stays unchanged.

## Final verification checklist

- [x] The new presence cases fail on `89ebe4d5` for the `tools` it filled, and pass after the change.
- [x] The touched suites pass.
- [x] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
