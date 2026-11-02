---
title: An action on a chat or session nobody has
domain: host
status: built
priority: high
created: 2026-11-02
revalidated: 2026-11-02
refs:
  - git://60fa2ccd - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentService.ts#L12462-L12467 - a chat channel's owner is looked up, and a session not loaded is restored first"
  - "https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentService.ts#L12482-L12490 - a chat with no owner: a read or an archive is refused, and any other action is taken and said"
  - "https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentService.ts#L12507-L12531 - a session's read or archive toggle on a session with no row is dropped, with nothing said"
  - "https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentService.ts#L12042-L12046 - no surfaced row is an unknown session, which the caller drops"
  - "https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentService.ts#L12552-L12563 - any other session action restores the session first"
  - "https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentService.ts#L12614-L12617 - a restore that fails refuses the action"
  - "https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentService.ts#L14082-L14084 - a session no provider answers for fails its restore"
  - "https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentService.ts#L13442-L13460 - the two refusals of a chat flag, and their words"
  - "https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentHostChatOwnershipService.ts#L173-L223 - where a chat's owner is looked for"
  - "https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2988-L2992 - an action for a chat with no entry is logged and reduces nothing"
  - "https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3079-L3091 - and goes out with the client's origin"
  - "https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4241-L4253 - an envelope goes to the clients whose subscription it is relevant to"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/session-channel.md#L166 - the specification's text: a server ignores an action naming a session that does not exist"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/chat-channel.md#L351 - and the same of a chat"
  - "[code://packages/sdk/src/host/actions.ts#L809-L824](../../../../packages/sdk/src/host/actions.ts#L809-L824) - a session's flag, kept and said for any session the channel names"
  - "[code://packages/sdk/src/host/actions.ts#L742-L751](../../../../packages/sdk/src/host/actions.ts#L742-L751) - an active client refused for a session this host does not know"
  - "[code://packages/sdk/src/host/chatactions.ts#L460-L505](../../../../packages/sdk/src/host/chatactions.ts#L460-L505) - an action naming nothing held is refused"
  - "[code://docs/sdk/AHP.md#L402-L413](../../../../docs/sdk/AHP.md#L402-L413) - what a refusal is"
---

## Goal

An action that names a chat or a session this host does not know is handled as VS Code's host handles it.
A session's read or archive toggle for an unknown session is dropped: nothing is kept and nothing is said.
Any other session action on an unknown session is refused.
A read or an archive of an unknown chat is refused.
Any other action on an unknown chat is said back on its channel, and runs nothing.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "sessionFlag|names nothing here|is not a session here" packages/sdk/src/host` - where an unknown target ends today.
- A session's toggle reaches `sessionFlag` for any session the channel names, which keeps the bit and says the catalogue row.
- An action on a chat no session holds ends in a refusal.
- The refusal is "names nothing here", a failed wake, or "is not a session this host knows".
- `knownSession` is the check this plan adds: running, listed, or recorded in the store as a session this host started.
- The catalogue is read for a session no check knows, as `session/configChanged` and a draft read it.
- VS Code main at `a1254744` looks a chat's owner up in its records and restores a session before an action that needs it.

### Runtime path

```
dispatchAction -> actions.ts
  -> a chat channel nothing knows -> the catalogue read -> a flag refused, or the action said on the chat's channel
  -> a session's flag on a session nothing knows -> the catalogue read -> nothing said, nothing kept
  -> any other session action on a session nothing knows -> refused, as today
```

### Gaps

- A session's toggle for a session nobody has keeps a bit for an id with no row.
- It also says a catalogue row for that id to every client of the root.
- An action on a chat nobody has is refused, where VS Code's host takes it.
- So a VS Code client rolls back an action that VS Code's host confirms.
- A chat action with attachments on a chat nobody has writes the files before it is refused.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A session is known when it is running, listed, or recorded in the store as one this host started | [code://packages/sdk/src/host/actions.ts#L742-L751](../../../../packages/sdk/src/host/actions.ts#L742-L751); [agentService.ts#L12042-L12046](https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentService.ts#L12042-L12046) | 01 |
| A chat is known when a running session holds it, the store records its session, or its URI names a known session | [agentHostChatOwnershipService.ts#L173-L223](https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentHostChatOwnershipService.ts#L173-L223) | 01 |
| A chat channel is one in the `ahp-chat:` scheme | [agentService.ts#L12462-L12466](https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentService.ts#L12462-L12466) | 01 |
| The catalogue is read for a session no check knows, before it is called unknown | [code://packages/sdk/src/host/chatactions.ts#L345-L380](../../../../packages/sdk/src/host/chatactions.ts#L345-L380) | 01 |
| A session's read or archive toggle for an unknown session is dropped, with nothing kept and nothing said | [agentService.ts#L12507-L12531](https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentService.ts#L12507-L12531); [session-channel.md#L166](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/session-channel.md#L166) | 01 |
| Any other session action on an unknown session is refused, as today | [agentService.ts#L12552-L12617](https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentService.ts#L12552-L12617) | 01 |
| A read of an unknown chat is refused "Only a known chat can change its read state." | [agentService.ts#L13442-L13460](https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentService.ts#L13442-L13460) | 01 |
| An archive of an unknown chat is refused with the reference host's archive sentence | [agentService.ts#L13442-L13460](https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentService.ts#L13442-L13460) | 01 |
| Any other action on an unknown chat goes out on the chat's channel with the client's origin, to its watchers, and nothing is reduced, kept or run | [agentService.ts#L12482-L12490](https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentService.ts#L12482-L12490); [agentHostStateManager.ts#L2988-L2992](https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2988-L2992) | 01 |
| `AHP.md` says how an action naming nothing here is answered | [code://docs/sdk/AHP.md#L402-L413](../../../../docs/sdk/AHP.md#L402-L413) | 01 |

## Proposed architecture

- **Event flow** - an action on an unknown chat is said on the chat's channel, as an accepted action is; a dropped toggle says nothing.
- **State flow** - nothing is kept for an unknown target: no bit, no draft, no file.
- **Layer responsibilities** - `actions.ts` decides an unknown target before any handler reads the channel for a session.
- **Source-of-truth files** - [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - An unknown target is answered as the reference host answers it](task-01-an-unknown-target-is-answered.md) | done | - |

## Risks and tradeoffs

- The catalogue is read for a target no check knows, as it is for a draft, so an unknown target costs a lookup.
- A worker chat of a known session is that session's, whatever its call: the backend that runs the worker decides an action on it.
- VS Code's host keeps a record of every worker it spawned and reads a worker with no record as unknown.
- A chat named outside the `ahp-chat:` scheme reads as a session's channel once nothing records it, as VS Code's host reads every other scheme.

## Resume state

- **Done so far:** task 01, 2026-11-02.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** a chat's URI resolves through `meantBy` before the check, so a known session's chat in any spelling is known.

## Final verification checklist

- [x] Each new case fails on `60fa2ccd` for the reason it names, and passes after the change; a control passes on both.
- [x] The touched suites pass.
- [x] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
