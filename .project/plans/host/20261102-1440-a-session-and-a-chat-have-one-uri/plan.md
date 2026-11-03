---
title: A session and a chat have one URI
domain: host
status: built
priority: high
created: 2026-11-02
revalidated: 2026-11-02
refs:
  - git://89ebe4d5 - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/common/agentHostClientInfo.ts#L8-L36 - the two names a VS Code window gives itself in `clientInfo`"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/common/meta/vscode/agentHostSessionUrisMeta.ts#L10-L41 - the `_meta` keys a window declares when it can address AHP sessions and opaque chats"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1054-L1055 - an older window is a VS Code window that declares neither, read at `initialize`"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1350-L1351 - and at `reconnect`, from the name it gave at `initialize`"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4326-L4355 - which sessions and chats such a window may see"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4362-L4409 - the chat list actions and a snapshot's chats, filtered for it"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4412-L4443 - the root notifications, filtered for it"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2383-L2392 - the listing, filtered for it"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1197-L1201 - a first subscription it may not see is left out"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1270-L1273 - a subscription it may not see is refused"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4547-L4553 - and no envelope on such a channel reaches it"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2348-L2350 - a move to a session it may not see is refused"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2213-L2221 - a client's new session is held under the channel it named"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentService.ts#L10074-L10108 - a session the host mints for a turn of an older window is minted under its provider"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentService.ts#L9019-L9026 - a chat's new session is minted native, whoever moved it"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentService.ts#L11472-L11490 - a subscription is keyed by the URI as the client sent it"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentService.ts#L14083 - and a URI no session is held under is not found"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/common/agentHostSessionIdentity.ts#L22-L26 - only a positively identified older VS Code needs the provider's name"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentHostChatOwnershipService.ts#L226-L242 - a derived default chat is its session's only while the session's record agrees"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/common/state/sessionState.ts#L899-L928 - a shaped chat URI, and an opaque one"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/chat-channel.md#L203-L204 - every moved chat keeps its URI"
  - "[code://.project/decisions/a-new-session-is-held-under-the-protocols-uri.md](../../../decisions/a-new-session-is-held-under-the-protocols-uri.md) - every new session this host makes is held as `ahp-session:/<id>`, and an existing session keeps its name"
  - "[code://packages/sdk/src/host/routing.ts#L41-L379](../../../../packages/sdk/src/host/routing.ts#L41-L379) - a session, its chats and its marks answered under any spelling of the id, and respelled per connection"
  - "[code://packages/sdk/src/host/routing.ts#L168-L183](../../../../packages/sdk/src/host/routing.ts#L168-L183) - a default chat URI not held as itself resolved to the session's current default chat"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L933-L975](../../../../packages/sdk/src/host/sessionmethods.ts#L933-L975) - a new session on another provider's scheme held as `ahp-session:/<id>`, the client's URI an alias"
  - "[code://packages/sdk/src/host.ts#L596-L739](../../../../packages/sdk/src/host.ts#L596-L739) - `broadcast` and `seenBy`, where an envelope is addressed and rewritten per connection"
  - "[code://packages/sdk/src/host/handshake.ts#L256-L360](../../../../packages/sdk/src/host/handshake.ts#L256-L360) - `initialize`, which reads no `clientInfo`"
  - "[code://packages/sdk/src/host/tooling.ts#L1724-L1777](../../../../packages/sdk/src/host/tooling.ts#L1724-L1777) - a session an agent's tool makes, named `ahp-session:/<uuid>`"
---

## Goal

A session and a chat are answered under one URI, the one they are held by, for every client.
An older VS Code window is identified as VS Code's host identifies one, and shown only the sessions and chats it can address.
A session a client creates is held under the URI it asked for.
A session this host makes for a turn of an older window is named in its provider's scheme, so that window can see it.
A default chat's URI names the session's default chat only while the session's record agrees.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "aliases|spelledFor|respelledIn|spellingOf|answeredAs" packages/sdk/src` - every place a session's other spelling is resolved or answered.
- `rg -n "heldAs|sessionOfChat|chatOf|meantBy" packages/sdk/src` - every reader of a session or chat URI a client names.
- `routing.ts` reads any URI's id and answers the session held under that id, in the client's spelling, with every URI inside respelled.
- `sessionOfChat` reads `ahp-chat:/<id>` as session `<id>`'s default chat, and a default chat URI as the session's current default.
- `initialize` keeps no `clientInfo`, so this host cannot tell an older VS Code window from any other client.
- VS Code main at `58a595f7` keeps every session under the URI it was created with and hides `ahp-session:` sessions from an older window.

### Runtime path

```
initialize / reconnect -> handshake.ts -> the connection's two older-window marks
listSessions, subscribe, root notifications, envelopes -> routing.ts visible -> what an older window is shown
subscribe / dispatchAction -> meantBy -> the channel as the client named it
createSession -> sessionmethods.ts -> held under the channel it named
a tool's new session -> tooling.ts -> the turn's sender -> the provider's scheme for an older window
```

### Gaps

- This host answers one session under every spelling of its id, and respells each snapshot and action into the spelling a client used.
- VS Code's host answers each session under one URI.
- An older VS Code window is shown `ahp-session:` sessions it cannot open, where VS Code's host hides them.
- A default chat URI is re-pointed to the session's next default chat, where VS Code's host leaves the URI with no owner.
- A session created on another provider's scheme is held as `ahp-session:/<id>`, where VS Code's host holds the URI the client named.

## Answers

| What | Source | Task |
| --- | --- | --- |
| An older VS Code window for sessions names itself `vscode-editor-window` or `vscode-agents-window` in `clientInfo` and does not declare `vscode.ahpSessionUris`; for chats, does not declare `vscode.ahpChatUris` | [protocolServerHandler.ts#L1054-L1055](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1054-L1055); [agentHostClientInfo.ts#L8-L36](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/common/agentHostClientInfo.ts#L8-L36) | 01 |
| A `reconnect` reads the name the client gave at `initialize`, and its own `_meta` | [protocolServerHandler.ts#L1350-L1351](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1350-L1351) | 01 |
| An older window for sessions sees no `ahp-session:` session: none listed, none subscribed, no root notification about one, no envelope on its channels | [protocolServerHandler.ts#L4326-L4329](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4326-L4329); [protocolServerHandler.ts#L4547-L4553](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4547-L4553) | 01 |
| An older window for chats sees only shaped chats in the session they name, and no session whose default chat is another | [protocolServerHandler.ts#L4330-L4355](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4330-L4355) | 01 |
| The session a shaped chat names is read from its URI; VS Code's host keeps a moved chat's first session in a record, and the URI holds the same session since a moved chat keeps its URI | (defaulted: the URI is this host's record of the session a chat was made in); [chat-channel.md#L203-L204](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/chat-channel.md#L203-L204) | 01 |
| Such a window's snapshot of a session, a row's chats, and the chat list actions carry only the chats it may see | [protocolServerHandler.ts#L4362-L4409](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4362-L4409) | 01 |
| A first subscription such a window may not see is left out, and a later one is refused `-32001` | [protocolServerHandler.ts#L1197-L1201](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1197-L1201); [protocolServerHandler.ts#L1270-L1273](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1270-L1273) | 01 |
| A move to a session such a window may not see is refused as a session not found | [protocolServerHandler.ts#L2348-L2350](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2348-L2350) | 01 |
| A session and a chat are answered under the URI they are held by, and under no other: no URI is read for its id, and nothing in a snapshot or an action is respelled | [agentService.ts#L11472-L11490](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentService.ts#L11472-L11490); [agentService.ts#L14083](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentService.ts#L14083) | 01 |
| An existing session keeps the URI it was created with, for every client | [agentHostSessionIdentity.ts#L22-L26](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/common/agentHostSessionIdentity.ts#L22-L26); [code://.project/decisions/a-new-session-is-held-under-the-protocols-uri.md](../../../decisions/a-new-session-is-held-under-the-protocols-uri.md) | 01 |
| A session a client creates is held under the channel it named, in any scheme a session may take | [protocolServerHandler.ts#L2213-L2221](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2213-L2221) | 01 |
| A session an agent's tool makes during a turn an older window sent is `<provider>:/<uuid>`; every other session this host makes is `ahp-session:/<uuid>`. This reverses the new-session half of decision `a-new-session-is-held-under-the-protocols-uri` for an older window, as VS Code's host mints for one | [agentService.ts#L10074-L10108](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentService.ts#L10074-L10108); [agentService.ts#L9019-L9026](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentService.ts#L9019-L9026) | 01 |
| `ahp-chat://default/<base64url(S)>` is session S's chat only while S records no default chat or records that one | [agentHostChatOwnershipService.ts#L226-L242](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentHostChatOwnershipService.ts#L226-L242) | 01 |
| `ahp-chat:/<id>` is a chat of its own URI, never session `<id>`'s default chat | [sessionState.ts#L899-L928](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/common/state/sessionState.ts#L899-L928) | 01 |
| The root and the automations catalogue keep the spellings they answer to; they are host channels, not sessions | [code://packages/sdk/src/host/routing.ts#L194-L207](../../../../packages/sdk/src/host/routing.ts#L194-L207) | 01 |
| A chat title the store holds under a default or worker chat's `ahp-session:` spelling is still read for a session held as `<provider>:/<id>` | [code://packages/sdk/src/host/spawn.ts#L492-L522](../../../../packages/sdk/src/host/spawn.ts#L492-L522) | 01 |
| The docs say one URI per session and per chat, and what an older window is shown | [code://docs/sdk/AHP.md#L615-L668](../../../../docs/sdk/AHP.md#L615-L668) | 02 |
| A config change, a draft or a turn under another spelling of a session held here is ignored with no echo, as a flag and a mark there are: the protocol has a server ignore it, and no VS Code window sends one, since a window dispatches on the URIs this host gave it | [session-channel.md#L166](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/session-channel.md#L166); [chat-channel.md#L351](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/chat-channel.md#L351) | 03 |
| Under a URI whose id no session here carries, a config change, a draft or a turn is answered as one for a session nobody has. A VS Code window can send one there, racing the session's removal, so VS Code's host's answers hold: a session's action is refused once its restore fails, and a chat's is said back, which plan `20261102-1236-an-action-on-a-chat-or-session-nobody-has` builds | [agentService.ts#L12494-L12503](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L12494-L12503); [agentService.ts#L12564-L12575](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L12564-L12575); [agentService.ts#L12626-L12629](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L12626-L12629) | - |

## Proposed architecture

- **State flow** - each connection holds two marks, `legacySessionUris` and `legacyChatUris`; the routing reads them.
- **Event flow** - `seenBy` drops an envelope that a connection may not see, and filters the chat list actions.
- **Event flow, root** - `broadcast` filters the three root notifications about sessions.
- **Layer responsibilities** - `routing.ts` resolves a URI and says what a connection may see; `handshake.ts` sets the marks.
- **Layer responsibilities, methods** - `sessionmethods.ts` lists, subscribes and creates; `tooling.ts` names a tool's new session.
- **Source-of-truth files** - [`code://packages/sdk/src/host/routing.ts`](../../../../packages/sdk/src/host/routing.ts), [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The host answers one URI, and an older window what it can address](task-01-the-host-answers-one-uri.md) | done | - |
| [02 - The docs say so](task-02-the-docs-say-so.md) | done | 01 |
| [03 - Another spelling's config change, draft and turn are ignored](task-03-another-spellings-config-draft-and-turn-are-ignored.md) | done | 01 |

## Risks and tradeoffs

- A client that names a session under another spelling of its id is told the session is not found.
- So is a saved link to `claude:/<id>` for a session held as `ahp-session:/<id>`.
- A client that holds `ahp-chat:/<id>` for session `<id>`'s default chat is told the chat is not found.
- An older VS Code window no longer lists `ahp-session:` sessions; it lists the sessions held in a provider's scheme and the ones it creates.
- A window that derives a default chat from its session finds no chat there once the session's default chat has moved.

## Resume state

- **Done so far:** tasks 01, 02 and 03, 2026-11-02.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** `sessionOfChat` also says whether a URI is a chat, so each caller is read again for an opaque chat.

## Final verification checklist

- [x] Each new case fails on `89ebe4d5` for the behavior it names, and passes after the change.
- [x] The touched suites pass.
- [x] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
