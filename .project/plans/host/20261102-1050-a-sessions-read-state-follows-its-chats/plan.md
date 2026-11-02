---
title: A session's read state follows its chats
domain: host
status: built
priority: high
created: 2026-11-02
revalidated: 2026-11-02
refs:
  - git://6e6d1ca8 - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2869-L2878 - a session marked read is said unread while one of its two or more chats is unread, and a session with one chat marks that chat read"
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2912-L2918 - a session with one chat marked unread marks that chat unread"
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2993-L3008 - a chat marked unread marks a read session unread, and the last chat read marks an unread session read"
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3101-L3109 - each follow-on action goes out after the action that caused it, as the host's own"
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/common/state/sessionState.ts#L2063-L2070 - `isChatInSessionReadAggregate`: a chat whose origin is not a tool and whose interactivity is not hidden"
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentService.ts#L12042-L12078 - the same rules on a session the host has not loaded, read off its catalog row's chats"
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentService.ts#L12097-L12160 - the same rules for a chat of a session the host has not loaded"
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/chatContributions/chatArchive/chatArchiveContribution.ts#L50-L51 - an archived chat is marked read with `chat/isReadChanged`, which moves the session by the same rules"
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/chatContributions/markUnread/markUnreadContribution.ts#L27-L49 - a turn's end marks its chat unread, then a read session unread"
  - "https://github.com/microsoft/vscode/blob/8fb60541db0e1a371ea40157e0f58951ae4a485d/src/vs/sessions/services/sessions/browser/sessionsManagementService.ts#L1446-L1448 - the Sessions window marks a session read by marking its main chat read"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L26-L36 - the specification's text: \"neither action implies the other\""
  - "[code://packages/sdk/src/host/chatactions.ts#L12-L111](../../../../packages/sdk/src/host/chatactions.ts#L12-L111) - `sessionFlag` and `chatFlag`, which each move one bit"
  - "[code://packages/sdk/src/host/chatactions.ts#L191-L254](../../../../packages/sdk/src/host/chatactions.ts#L191-L254) - a client's chat bit, and an archive's mark-read"
  - "[code://packages/sdk/src/host/actions.ts#L809-L824](../../../../packages/sdk/src/host/actions.ts#L809-L824) - `session/isReadChanged` into `sessionFlag`"
  - "[code://packages/sdk/src/host/spawn.ts#L1449-L1500](../../../../packages/sdk/src/host/spawn.ts#L1449-L1500) - a turn's start and end move the chat's bit, and the session's at its end"
  - "[code://packages/sdk/src/host/snapshots.ts#L659-L712](../../../../packages/sdk/src/host/snapshots.ts#L659-L712) - the chats a session nothing is running opens with"
  - "[code://.project/plans/host/20261101-0331-a-chats-read-state-is-its-own/plan.md](../20261101-0331-a-chats-read-state-is-its-own/plan.md) - the answers this plan reverses, which keep each bit apart"
  - "[code://packages/sdk/test/host-catalogue.test.ts#L501-L783](../../../../packages/sdk/test/host-catalogue.test.ts#L501-L783) - the tests that hold each bit apart"
---

## Goal

A session's read bit and its chats' read bits move each other, as VS Code's host couples them.
A session marked read while one of its two or more chats is unread stays unread, and the client's own action says so.
A session with one chat moves that chat's bit with its own, read or unread.
A chat marked unread marks a read session unread, and the last chat read marks an unread session read.
A chat a tool opened and a hidden chat keep their own bits and move nothing of the session's.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "sessionFlag|chatFlag|startsRead" packages/sdk/src/host` - `sessionFlag` and `chatFlag` are the only writers of a read bit; `startsRead` sets a new chat's bit before anybody is told.
- `rg -n "chat/isReadChanged|session/isReadChanged" packages/sdk/src` - a client's chat bit, an archive's mark-read, a turn's start and end, and a client's session bit.
- VS Code main at `37eba093`: `agentHostStateManager.ts` couples the bits in `_applyAndEmit`, for a client's action and the host's own alike.
- The same file runs no rule at a turn's start: the chat reducer clears the chat's bit, and no `chat/isReadChanged` is sent.
- `agentService.ts` applies the same rules to a session it has not loaded, through its catalog row's chats.
- `markUnreadContribution.ts` marks a turn's chat unread, then a read session unread, as `spawn.ts` does now.

### Runtime path

```
client session/isReadChanged -> actions.ts -> readAggregate -> sessionFlag on the session -> chatFlag on a sole chat
client chat/isReadChanged -> chatactions.ts -> chatFlag on the chat -> sessionFollows -> sessionFlag on the session
client chat/isArchivedChanged -> chatFlag archived -> chatFlag read -> sessionFollows
backend turn end -> spawn.ts -> chatFlag unread -> sessionFlag unread
```

### Gaps

- A client's `session/isReadChanged` moves the session alone.
- VS Code's host says a read of a session with an unread chat among several as unread, and moves a sole chat with the session.
- A client's `chat/isReadChanged` moves the chat alone.
- VS Code's host marks a read session unread when the chat goes unread, and an unread session read when its last unread chat is read.
- An archive's mark-read moves the chat alone, where VS Code's host moves the session with it by the same rule.
- The Sessions window marks a session read by marking its main chat read.
- So against this host, a session that a turn's end left unread stays unread after it is opened.
- The specification's text keeps the bits apart; its author coupled them in VS Code's host after writing that text, and VS Code's host decides here.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The chats a session's read bit is made of are its open chats, but a chat whose origin is a tool and a hidden chat | [sessionState.ts#L2063-L2070](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/common/state/sessionState.ts#L2063-L2070) | 01 |
| A running session's chats are the ones it holds; one nothing is running has the chats its state opens with | [code://packages/sdk/src/host/snapshots.ts#L659-L712](../../../../packages/sdk/src/host/snapshots.ts#L659-L712); [agentService.ts#L12042-L12078](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentService.ts#L12042-L12078) | 01 |
| A client's session read, with two or more of those chats and one unread, is said with `isRead: false`, under the client's origin | [agentHostStateManager.ts#L2869-L2874](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2869-L2874) | 01 |
| A session with one such chat moves that chat to the session's new bit after the session's action, whether or not the session's bit moved | [agentHostStateManager.ts#L2875-L2876](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2875-L2876); [agentHostStateManager.ts#L2912-L2918](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2912-L2918) | 01 |
| A client's chat unread, on one of those chats, marks a read session unread with this host's own action | [agentHostStateManager.ts#L2998-L2999](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2998-L2999) | 01 |
| A client's chat read marks an unread session read once every one of those chats is read, unless the chat was read already and has a sibling | [agentHostStateManager.ts#L3000-L3005](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3000-L3005) | 01 |
| The chat's rule runs whether or not the chat's own bit moved | [agentHostStateManager.ts#L2968-L2970](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2968-L2970) | 01 |
| An archive's mark-read of an unread chat moves the session by the chat's rule | [chatArchiveContribution.ts#L50-L51](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/chatContributions/chatArchive/chatArchiveContribution.ts#L50-L51) | 01 |
| A turn's start moves no session bit, and a turn's end marks the chat, then a read session, unread, as now | [agentHostStateManager.ts#L2968-L2970](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2968-L2970); [markUnreadContribution.ts#L27-L49](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/chatContributions/markUnread/markUnreadContribution.ts#L27-L49) | 01 |
| `AHP.md` says how the read actions move each other | [code://docs/sdk/AHP.md#L252](../../../../docs/sdk/AHP.md#L252) | 02 |

## Proposed architecture

- **Event flow** - a client's read action moves its own bit, then the bits that VS Code's host moves with it.
- **Channels** - each bit moves by its own action on its own channel.
- **State flow** - the store keeps one read bit per session and one per chat; the rules read the chats a session's bit is made of.
- **Layer responsibilities** - `readAggregate` names those chats; `sessionFollows` moves the session after a chat; the session's action moves a sole chat.
- **Source-of-truth files** - [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts), [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A session and its chats move each other](task-01-a-session-and-its-chats-move-each-other.md) | done | - |
| [02 - The docs say how the bits move](task-02-the-docs-say-how-the-bits-move.md) | done | 01 |

## Risks and tradeoffs

- A client that marks a session read while a chat is unread sees it stay unread; it marks the chat, as the Sessions window does.
- A client that marks only sessions, and holds sessions of two or more chats, is answered unread where it asked for read.

## Resume state

- **Done so far:** tasks 01 and 02, 2026-11-02.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** a turn's start clears a chat's bit through the chat reducer, so it moves no session bit.

## Final verification checklist

- [x] Each new or changed case fails on `6e6d1ca8` for the reason it names, and passes after the change.
- [x] The touched suites pass, every protocol case among them.
- [x] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
