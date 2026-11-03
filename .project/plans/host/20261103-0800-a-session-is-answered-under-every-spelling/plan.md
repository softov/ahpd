---
title: A session is answered under every spelling
domain: host
status: planned
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://cde4dd6c - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/state/sessionState.ts#L894-L898 - a chat's owner and storage come from the records that hold it, never from its URI"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentHostChatOwnershipService.ts#L264-L287 - a session's identities are its registered URI, `ahp-session:/<id>` and `<provider>:/<id>`, and the chat derived from each names it"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentHostChatOwnershipService.ts#L226-L242 - a derived default chat is the session's while the session's record agrees"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L14091-L14096 - not found is the answer where no agent serves the URI"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L12507-L12513 - a dispatch on an annotations channel restores that session's annotations first"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3040-L3045 - annotations are seeded on a first write rather than dropped"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4344-L4351 - an older window sees a shaped chat only in the session its recorded origin names"
  - "[code://packages/sdk/src/host/routing.ts#L56-L70](../../../../packages/sdk/src/host/routing.ts#L56-L70) - `nameOf` and `heldElsewhere`, which made another spelling no session"
  - "[code://packages/sdk/src/host/routing.ts#L106-L150](../../../../packages/sdk/src/host/routing.ts#L106-L150) - `sessionOfChat`, `meantBy` and `shownToOlder`"
  - "[code://packages/sdk/test/host-names.test.ts#L284-L390](../../../../packages/sdk/test/host-names.test.ts#L284-L390) - the cases of a name a client computed"
---

## Goal

Every spelling of a session's id names that session: the name its row carries, `ahp-session:/<id>`, and the scheme of a provider this host serves.
A client is answered under the name it used, and a scheme no agent here serves names no session.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "heldElsewhere" packages/sdk/src` - six sites drop or refuse an action under another spelling.
- `rg -n "meantBy\(" packages/sdk/src` - every road reads it: a dispatch, a subscribe, the methods, the handshake's resumes.
- `rg -n "aliases" packages/sdk/src/host.ts` - a connection's alias is what answers a client in its own spelling.

### Runtime path

```
subscribe or dispatch -> meantBy -> the session this host publishes -> answeredAs records the alias
an action on the session -> dispatch -> the connection watching the alias is told under its own spelling
```

### Gaps

- Another spelling of a held id was no session: a subscribe and a wake were refused there.
- A flag and a mark were dropped there, and a config change, a draft and a turn were ignored.
- A shaped chat was shown to an older window only under the exact spelling its URI carries.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A chat's URI is not its owner: "a chat's owner and storage come from the records that contain it" | [sessionState.ts#L894-L898](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/state/sessionState.ts#L894-L898) | 01 |
| A session has an identity per scheme, and the chat derived from each identity names that session: the index maps every derived chat to its identity | [agentHostChatOwnershipService.ts#L264-L287](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentHostChatOwnershipService.ts#L264-L287) | 01 |
| A derived default chat is the session's while its record agrees: `recorded === undefined || recorded === chat` | [agentHostChatOwnershipService.ts#L226-L242](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentHostChatOwnershipService.ts#L226-L242) | 01 |
| Not found is the answer where no agent answers the URI: `No agent for session` | [agentService.ts#L14091-L14096](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L14091-L14096) | 01 |
| A mark is not dropped: the session's annotations are restored for the dispatch, and the state is seeded on a first write | [agentService.ts#L12507-L12513](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L12507-L12513); [agentHostStateManager.ts#L3040-L3045](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3040-L3045) | 01 |
| An older window sees a shaped chat in the session its origin names, `(getMovedChatOrigin(chat) ?? session) === session`, so a chat keeps the session it was minted for and a moved chat leaves the sight of the session it moved to | [protocolServerHandler.ts#L4344-L4351](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4344-L4351) | 01 |
| One name per session is the `resource` its row and notifications carry, which is this host's own and stays | `(defaulted: the protocol has one `resource` per row)` | - |

## Proposed architecture

- **State flow** - `meantBy` resolves a session channel, its marks, its changesets and a chat derived from it to the name this host publishes.
- **Answering** - `answeredAs` answers the client in its own spelling, through the alias the connection keeps.
- **Layer responsibilities** - sdk: the routing, and the sites that dropped an action.
- **Source-of-truth files** - [`code://packages/sdk/src/host/routing.ts`](../../../../packages/sdk/src/host/routing.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Every spelling of an id is the session](task-01-every-spelling-of-an-id-is-the-session.md) | todo | - |

## Risks and tradeoffs

- A client that names a session two ways holds two channels for one session, each answered under its own spelling, as under the reference host.

## Resume state

- **Done so far:** nothing.
- **Next action:** task 01.
- **Open questions:** none.
- **Watch out for:** a scheme no agent here serves names no session, whatever id it carries.

## Final verification checklist

- [ ] The changed cases fail on `cde4dd6c` for the reasons they name, and pass after the change.
- [ ] The names, gate, chats, snapshot and catalogue test files pass.
- [ ] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
